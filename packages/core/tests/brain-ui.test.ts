import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import {
  finalStateFromEvents,
  mockStreamText,
  mockGenerateObject,
  mockClient,
} from './brain-test-helpers.js';

describe('UI steps', () => {
  // Mock components for UI generation
  const mockComponents = {
    Form: {
      component: () => null,
      description: 'A form container',
    },
    Input: {
      component: () => null,
      description: 'A text input',
    },
  };

  // Mock pages service
  const mockPages = {
    create: jest.fn<any>().mockResolvedValue({
      slug: 'test-page',
      url: 'https://example.com/pages/test-page',
      brainRunId: 'test-run',
      persist: false,
      createdAt: new Date().toISOString(),
    }),
    get: jest.fn(),
    exists: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(() => {
    mockStreamText.mockClear();
    mockGenerateObject.mockClear();
    mockPages.create.mockClear();

    // Mock streamText to return a valid YAML template for generatePage
    mockStreamText.mockResolvedValue({
      toolCalls: [],
      text: `Form:\n  children:\n    - Input:\n        name: "field1"\n        label: "Field 1"`,
      usage: { totalTokens: 100 },
    });
  });

  it('should suspend at WEBHOOK when outputSchema is provided (initial run)', async () => {
    const testBrain = brain('UI Form Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ userName: 'Alice' }))
      .page('Collect Feedback', ({ state }) => ({
        prompt: `Create a form for ${state.userName}`,
        formSchema: z.object({ rating: z.number() }),
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
    })) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.type);

    // Should emit WEBHOOK event
    const webhookIndex = eventTypes.indexOf(BRAIN_EVENTS.WEBHOOK);
    expect(webhookIndex).toBeGreaterThan(-1);

    // No STEP_COMPLETE for the UI step before WEBHOOK —
    // the step spans the suspend/resume boundary
    const stepCompletesBeforeWebhook = events
      .slice(0, webhookIndex)
      .filter((e) => e.type === BRAIN_EVENTS.STEP_COMPLETE);
    // Only the Init step should have completed before WEBHOOK
    expect(stepCompletesBeforeWebhook).toHaveLength(1);
    expect((stepCompletesBeforeWebhook[0] as any).stepTitle).toBe('Init');
  });

  it('should merge form response onto state when resumed', async () => {
    const feedbackSchema = z.object({
      rating: z.number(),
      comments: z.string(),
    });

    const testBrain = brain('UI Resume Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ userName: 'Alice' }))
      .page('Collect Feedback', ({ state }) => ({
        prompt: `Create a form for ${state.userName}`,
        formSchema: feedbackSchema,
      }))
      .step('After UI', ({ state }) => ({
        ...state,
        processed: true,
      }));

    // Resume with webhook response — the UI step is at index 1
    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
      brainRunId: 'test-run',
      resume: {
        state: { userName: 'Alice' },
        stepIndex: 1, // UI step index
        webhookResponse: { rating: 5, comments: 'Great!' },
      },
    })) {
      events.push(event);
    }

    // Reconstruct state by applying STEP_COMPLETE patches to the resume state
    let finalState: any = { userName: 'Alice' };
    for (const event of events) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [(event as any).patch]);
      }
    }

    expect(finalState.rating).toBe(5);
    expect(finalState.comments).toBe('Great!');
    expect(finalState.processed).toBe(true);

    // The UI step should complete with a patch that includes the merge
    const uiStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        (e as any).stepTitle === 'Collect Feedback'
    );
    expect(uiStepComplete).toBeDefined();
    expect((uiStepComplete as any).patch.length).toBeGreaterThan(0);

    // Brain should complete
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should complete immediately for read-only UI (no outputSchema)', async () => {
    const testBrain = brain('Read-only UI Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ data: 'hello' }))
      .page('Dashboard', ({ state }) => ({
        prompt: `Show dashboard for ${state.data}`,
      }))
      .step('After', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
    })) {
      events.push(event);
    }

    // Should complete without suspending
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(events.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(false);

    // Read-only UI step should emit pageContext on its STEP_COMPLETE
    const uiStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        (e as any).stepTitle === 'Dashboard'
    ) as any;
    expect(uiStepComplete.pageContext).toBeDefined();
    expect(uiStepComplete.pageContext.url).toBe(
      'https://example.com/pages/test-page'
    );

    const finalState = finalStateFromEvents(events);
    expect(finalState.done).toBe(true);
  });
});
