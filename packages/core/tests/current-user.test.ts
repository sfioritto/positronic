import { jest } from '@jest/globals';
import { brain } from '../src/dsl/builder/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type { CurrentUser, StepContext } from '../src/dsl/types.js';
import type { BrainStartEvent } from '../src/dsl/definitions/events.js';
import { z } from 'zod';

// Helper function to collect all events from a brain run
const collectEvents = async <T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
};

// Mock ObjectGenerator for testing
const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('currentUser', () => {
  it('should be available in step context when provided via run params', async () => {
    const mockClient = createMockClient();
    let receivedUser: CurrentUser | undefined;

    const testBrain = brain('test-brain')
      .step('Check User', ({ currentUser }) => {
        receivedUser = currentUser;
        return { done: true };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'user-123' },
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(receivedUser).toEqual({ name: 'user-123' });
  });

  it('should appear in the START event payload', async () => {
    const mockClient = createMockClient();

    const testBrain = brain('test-brain')
      .step('Noop', () => ({ done: true }));

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'user-456' },
      })
    );

    const startEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.START
    ) as BrainStartEvent;
    expect(startEvent).toBeDefined();
    expect(startEvent.currentUser).toEqual({ name: 'user-456' });
  });

  it('should be available in agent tool execute context', async () => {
    const mockClient = createMockClient();
    let toolReceivedUser: CurrentUser | undefined;

    // Mock generateText for the agent
    mockClient.generateText = jest.fn<any>().mockResolvedValue({
      text: '',
      toolCalls: [
        {
          toolName: 'checkUser',
          toolCallId: 'call-1',
          args: { input: 'test' },
        },
      ],
      responseMessages: [{ role: 'assistant', content: 'test' }],
      usage: { totalTokens: 10 },
    });

    // After checkUser is called, the next iteration returns the done tool
    (mockClient.generateText as any).mockResolvedValueOnce({
      text: '',
      toolCalls: [
        {
          toolName: 'checkUser',
          toolCallId: 'call-1',
          args: { input: 'test' },
        },
      ],
      responseMessages: [{ role: 'assistant', content: 'test' }],
      usage: { totalTokens: 10 },
    }).mockResolvedValueOnce({
      text: '',
      toolCalls: [
        {
          toolName: 'done',
          toolCallId: 'call-2',
          args: { result: 'completed' },
        },
      ],
      responseMessages: [{ role: 'assistant', content: 'done' }],
      usage: { totalTokens: 5 },
    });

    const testBrain = brain('test-brain')
      .brain('Agent Step', {
        system: 'You are a test agent',
        prompt: 'Check the user',
        tools: {
          checkUser: {
            description: 'Check who the current user is',
            inputSchema: z.object({ input: z.string() }),
            execute: async (input: any, context: StepContext) => {
              toolReceivedUser = context.currentUser;
              return 'checked';
            },
          },
        },
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'user-789' },
      })
    );

    expect(toolReceivedUser).toEqual({ name: 'user-789' });
  });

  it('should persist through step chains (same value in all steps)', async () => {
    const mockClient = createMockClient();
    const usersReceived: (CurrentUser | undefined)[] = [];

    const testBrain = brain('test-brain')
      .step('Step 1', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 1 };
      })
      .step('Step 2', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 2 };
      })
      .step('Step 3', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 3 };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'persistent-user' },
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(usersReceived).toHaveLength(3);
    expect(usersReceived[0]).toEqual({ name: 'persistent-user' });
    expect(usersReceived[1]).toEqual({ name: 'persistent-user' });
    expect(usersReceived[2]).toEqual({ name: 'persistent-user' });
  });
});
