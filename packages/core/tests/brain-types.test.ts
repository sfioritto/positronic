import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { brain } from '../src/dsl/brain.js';
import { z } from 'zod';
import {
  finalStateFromEvents,
  mockClient,
  type AssertEquals,
} from './brain-test-helpers.js';

describe('type inference', () => {
  it('should correctly infer complex brain state types', async () => {
    // Create an inner brain that uses the shared options type
    const optionsSchema = z.object({
      features: z.array(z.string()),
    });

    const innerBrain = brain('Inner Type Test')
      .withOptionsSchema(optionsSchema)
      .step('Process features', ({ options }) => ({
        processedValue: options.features.includes('fast') ? 100 : 42,
        featureCount: options.features.length,
      }));

    // Create a complex brain using multiple features
    const complexBrain = brain('Complex Type Test')
      .withOptionsSchema(optionsSchema)
      .step('First step', ({ options }) => ({
        initialFeatures: options.features,
        value: 42,
      }))
      .brain('Nested brain', innerBrain, {
        initialState: {
          processedValue: 0,
          featureCount: 0,
        },
        options: ({ options }) => options,
      })
      .step('Final step', ({ state }) => ({
        ...state,
        completed: true as const,
      }));

    // Type test setup
    type ExpectedState = {
      initialFeatures: string[];
      value: number;
      processedValue: number;
      featureCount: number;
      completed: true;
    };

    type ActualState = Parameters<
      Parameters<(typeof complexBrain)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;

    // Collect all events
    const events = [];
    let finalStepStatus;
    let mainBrainId: string | undefined;

    for await (const event of complexBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: { features: ['fast', 'secure'] },
    })) {
      events.push(event);

      // Capture the main brain's ID from its start event
      if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
        mainBrainId = event.brainRunId;
      }

      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      }
    }
    const finalState = finalStateFromEvents(events);

    // Verify brain start event
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'Complex Type Test',
        brainDescription: undefined,
        options: { features: ['fast', 'secure'] },
        brainRunId: mainBrainId,
      })
    );

    // Verify inner brain events are included (inner brains share brainRunId with outer)
    const innerStartEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.START && e.brainTitle === 'Inner Type Test'
    );
    expect(innerStartEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'Inner Type Test',
        options: { features: ['fast', 'secure'] },
      })
    );

    // Verify the final step status
    if (!finalStepStatus) throw new Error('Expected final step status event');
    const lastStep = finalStepStatus.steps[finalStepStatus.steps.length - 1];
    expect(lastStep.status).toBe(STATUS.COMPLETE);
    expect(lastStep.title).toBe('Final step');

    expect(finalState).toEqual({
      initialFeatures: ['fast', 'secure'],
      value: 42,
      processedValue: 100,
      featureCount: 2,
      completed: true,
    });
  });

  it('should correctly infer brain outputKey state types', async () => {
    // Create an inner brain with a specific state shape
    const innerBrain = brain('Inner State Test').step('Inner step', () => ({
      innerValue: 42,
      metadata: { processed: true as const },
    }));

    // Create outer brain to test outputKey type inference
    const outerBrain = brain('Outer State Test')
      .step('First step', () => ({
        outerValue: 100,
        status: 'ready',
      }))
      .brain('Nested brain', innerBrain)
      .step('Verify types', ({ state }) => {
        // Type assertion for merged state (inner brain state spread flat)
        type ExpectedState = {
          outerValue: number;
          status: string;
          innerValue: number;
          metadata: { processed: true };
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return state;
      });

    // Run the brain to verify runtime behavior
    const events = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toEqual({
      outerValue: 100,
      status: 'ready',
      innerValue: 42,
      metadata: { processed: true },
    });
  });

  it('should pass independent options to inner brain', async () => {
    // Inner brain has its own options schema, different from the parent
    const innerBrain = brain('Independent Options Inner')
      .withOptionsSchema(z.object({ multiplier: z.number() }))
      .step('Multiply', ({ state, options }) => ({
        result: (state as any).value * options.multiplier,
      }));

    // Outer brain has a completely different options schema
    const outerBrain = brain('Independent Options Outer')
      .withOptionsSchema(z.object({ label: z.string() }))
      .step('Init', ({ options }) => ({
        value: 10,
        label: options.label,
      }))
      .brain('Compute', innerBrain, {
        initialState: ({ state }) => ({ value: state.value }),
        options: { multiplier: 3 },
      })
      .step('Final', ({ state }) => ({
        ...state,
        done: true,
      }));

    const events = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: { label: 'test' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toEqual({
      value: 10,
      label: 'test',
      result: 30,
      done: true,
    });

    // Verify inner brain received its own options, not the parent's
    const innerStartEvent = events.find(
      (e: any) =>
        e.type === BRAIN_EVENTS.START &&
        e.brainTitle === 'Independent Options Inner'
    );
    expect(innerStartEvent).toEqual(
      expect.objectContaining({
        options: { multiplier: 3 },
      })
    );
  });

  it('should correctly infer step action state types', async () => {
    const testBrain = brain('Action State Test')
      .step('First step', () => ({
        count: 1,
        metadata: { created: new Date().toISOString() },
      }))
      .step('Second step', ({ state }) => {
        // Type assertion for action state
        type ExpectedState = {
          count: number;
          metadata: { created: string };
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return {
          ...state,
          count: state.count + 1,
          metadata: {
            ...state.metadata,
            updated: new Date().toISOString(),
          },
        };
      });

    // Run the brain to verify runtime behavior
    const events = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toMatchObject({
      count: 2,
      metadata: {
        created: expect.any(String),
        updated: expect.any(String),
      },
    });
  });

  it('should correctly infer prompt response types in subsequent steps', async () => {
    const testBrain = brain('Prompt Type Test')
      .prompt('Get user info', () => ({
        message: "What is the user's info?",
        outputSchema: z.object({ name: z.string(), age: z.number() }),
      }))
      .step('Use response', ({ state }) => {
        // Type assertion to verify state includes prompt result spread flat
        type ExpectedState = {
          name: string;
          age: number;
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return {
          ...state,
          greeting: `Hello ${state.name}, you are ${state.age} years old`,
        };
      });

    // Mock the client response
    mockClient.generateObject.mockResolvedValueOnce({
      object: { name: 'Test User', age: 30 },
    });

    // Run brain and collect final state
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the brain executed correctly (prompt result spread flat)
    expect(finalState).toEqual({
      name: 'Test User',
      age: 30,
      greeting: 'Hello Test User, you are 30 years old',
    });
  });
});
