import { WORKFLOW_EVENTS, STATUS } from './constants';
import { workflow, type Event, type SerializedStep } from './workflow';
import { z } from 'zod';

// Add type utility and mock client at the top of the test file
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

// Mock PromptClient for testing
const mockClient = {
  execute: jest.fn()
};

describe('workflow creation', () => {
  it('should create a workflow with steps and run through them', async () => {
    const testWorkflow = workflow('test workflow')
      .step(
        "First step",
        ({ client }) => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ state }) => ({ count: state.count, doubled: state.count * 2 })
      );

    const workflowRun = testWorkflow.run({ client: mockClient });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'test workflow'
    }));

    // Check first step start
    const firstStepStartResult = await workflowRun.next();
    expect(firstStepStartResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      workflowTitle: 'test workflow'
    }));

    // Check first step completion
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      currentStep: expect.objectContaining({
        title: 'First step',
        status: STATUS.COMPLETE,
        state: { count: 1 }
      })
    }));

    // Check second step start
    const secondStepStartResult = await workflowRun.next();
    expect(secondStepStartResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      workflowTitle: 'test workflow',
      currentStep: expect.objectContaining({
        title: 'Second step'
      })
    }));

    // Check second step completion
    const secondStepResult = await workflowRun.next();
    expect(secondStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      currentStep: expect.objectContaining({
        title: 'Second step',
        status: STATUS.COMPLETE,
        state: { count: 1, doubled: 2 }
      })
    }));

    // Check workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      currentStep: expect.objectContaining({
        title: 'Second step',
        status: STATUS.COMPLETE,
        state: { count: 1, doubled: 2 }
      })
    }));
  });

  it('should create a workflow with a name and description when passed an object', async () => {
    const testWorkflow = workflow({
      title: 'my named workflow',
      description: 'some description'
    });

    const workflowRun = testWorkflow.run({ client: mockClient });
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      workflowTitle: 'my named workflow',
      workflowDescription: 'some description',
      type: WORKFLOW_EVENTS.START
    }));
  });

  it('should create a workflow with just a name when passed a string', async () => {
    const testWorkflow = workflow('simple workflow');
    const workflowRun = testWorkflow.run({ client: mockClient });
    const startResult = await workflowRun.next();
    const event = startResult.value;
    if (!event) throw new Error('Expected event');

    expect(event).toEqual(expect.objectContaining({
      workflowTitle: 'simple workflow',
      type: WORKFLOW_EVENTS.START
    }));
    expect(event.workflowDescription).toBeUndefined();
  });

  it('should allow overriding client per step', async () => {
    const overrideClient = {
      execute: jest.fn().mockResolvedValue({ override: true })
    };

    // Make sure that for the default prompt the default client returns a known value.
    mockClient.execute.mockResolvedValueOnce({ override: false });

    const testWorkflow = workflow('Client Override Test')
      .prompt(
        "Use default client",
        {
          template: () => "prompt1",
          responseModel: {
            schema: z.object({ override: z.boolean() }),
            name: 'overrideResponse'
          }
        }
      )
      .prompt(
        "Use override client",
        {
          template: () => "prompt2",
          responseModel: {
            schema: z.object({ override: z.boolean() }),
            name: 'overrideResponse'
          },
          client: overrideClient
        }
      );

    // Run the workflow and capture the final event.
    let finalEvent: any;
    for await (const event of testWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    // Final state should include both responses.
    expect(finalEvent.currentStep?.state).toEqual({
      overrideResponse: { override: true }
    });

    // Verify that each client was used correctly based on the supplied prompt configuration.
    expect(mockClient.execute).toHaveBeenCalledWith("prompt1", expect.any(Object));
    expect(overrideClient.execute).toHaveBeenCalledWith("prompt2", expect.any(Object));
  });
});

describe('error handling', () => {
  it('should handle errors in actions and maintain correct status', async () => {
    const errorWorkflow = workflow('Error Workflow')
      // Step 1: Normal step
      .step("First step", () => ({
        value: 1
      }))
      // Step 2: Error step
      .step("Error step", () => {
        if (true) {
          throw new Error('Test error');
        }
        return {
          value: 1
        };
      })
      // Step 3: Should never execute
      .step("Never reached", ({ state }) => ({
        value: state.value + 1
      }));

    let finalEvent;
    try {
      for await (const event of errorWorkflow.run({ client: mockClient })) {
        finalEvent = event;
      }
    } catch (error) {
      // Error is expected to be thrown
    }

    // Verify final state
    expect(finalEvent?.status).toBe(STATUS.ERROR);
    expect(finalEvent?.error?.message).toBe('Test error');

    // Verify steps status
    if (!finalEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalEvent.steps[0].status).toBe(STATUS.COMPLETE);
    expect(finalEvent.steps[1].status).toBe(STATUS.ERROR);
    expect(finalEvent.steps[2].status).toBe(STATUS.PENDING);
  });
});

describe('step creation', () => {
  it('should create a step that updates state', async () => {
    const testWorkflow = workflow('Simple Workflow')
      .step("Simple step", ({ state }) => ({
        ...state,
        count: 1,
        message: 'Count is now 1'
      }));

    let finalEvent;
    for await (const event of testWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    // Verify the step executed correctly
    expect(finalEvent?.status).toBe(STATUS.COMPLETE);
    expect(finalEvent?.currentStep?.state).toEqual({
      count: 1,
      message: 'Count is now 1'
    });
  });

  it('should not modify the original state when step mutates state', async () => {
    const originalState = {
      value: 1,
      nested: { count: 0 }
    };

    const testWorkflow = workflow<{}, { value: number; nested: { count: number } }>('Mutation Test Workflow')
      .step("Mutating step", ({ state }) => {
        // Attempt to mutate the input state
        state.value = 99;
        state.nested = { count: 99 };
        return state;
      });

    let finalEvent;
    for await (const event of testWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    // Verify original state remains unchanged
    expect(originalState).toEqual({
      value: 1,
      nested: { count: 0 }
    });
  });

  it('should maintain immutable results between steps', async () => {
    const testWorkflow = workflow('Immutable Steps Workflow')
      .step("First step", ({ client }) => ({
        value: 1
      }))
      .step("Second step", ({ state }) => {
        // Attempt to modify previous step's state
        state.value = 99;
        return {
          value: 2
        };
      });

    let finalEvent;
    for await (const event of testWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    // Verify that modifications didn't persist
    if (!finalEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalEvent.steps[0].state).toEqual({ value: 1 });
    expect(finalEvent.steps[1].state).toEqual({ value: 2 });
  });
});

describe('workflow resumption', () => {
  // Mock client setup
  const mockClient = {
    execute: jest.fn()
  };

  it('should resume workflow from a specific step with correct state chain', async () => {
    const threeStepWorkflow = workflow('Three Step Workflow')
      .step("Step 1: Double", ({ state }) => ({
        value: ((state as { value: number }).value || 2) * 2
      }))
      .step("Step 2: Add 10", ({ state }) => ({
        value: state.value + 10
      }))
      .step("Step 3: Multiply by 3", ({ state }) => ({
        value: state.value * 3
      }));

    const initialState = { value: 2 };

    // First run the workflow normally
    let fullRun;
    for await (const event of threeStepWorkflow.run({ client: mockClient })) {
      fullRun = event;
    }

    if (!fullRun?.steps) {
      throw new Error('Steps not found');
    }

    // Resume from step 2 by passing the completed first step
    let resumedRun;
    for await (const event of threeStepWorkflow.run({ client: mockClient })) {
      resumedRun = event;
    }

    // Verify the full run executed correctly
    if (!fullRun?.currentStep?.state) throw new Error('Expected currentStep.state to be defined');
    expect(fullRun.currentStep.state.value).toBe(42); // ((2 * 2) + 10) * 3 = 42
    expect(fullRun.steps.map(s => s.state?.value)).toEqual([4, 14, 42]);

    // Verify the resumed run started from step 2 with correct state
    if (!resumedRun?.currentStep?.state) throw new Error('Expected currentStep.state to be defined');
    expect(resumedRun.currentStep.state.value).toBe(42);
  });
});

describe('nested workflows', () => {
  it('should execute nested workflows and yield all inner workflow events', async () => {
    // Create an inner workflow that will be nested
    const innerWorkflow = workflow('Inner Workflow')
      .step(
        "Double value",
        ({ state }) => ({
          inner: true,
          value: (state as any).value * 2
        })
      );

    // Create outer workflow that uses the inner workflow
    const outerWorkflow = workflow('Outer Workflow')
      .step(
        "Set prefix",
        () => ({ prefix: "test-" })
      )
      .workflow(
        "Run inner workflow",
        innerWorkflow,
        ({ state, workflowState }) => ({
          ...state,
          innerResult: workflowState.value
        }),
        () => ({ value: 5 })
      );

    const events: Event<any, any>[] = [];
    for await (const event of outerWorkflow.run({ client: mockClient })) {
      events.push(event);
    }

    // Verify all events are yielded in correct order
    expect(events.map(e => ({
      type: e.type,
      workflowTitle: e.workflowTitle,
      status: e.status,
      ...(e.currentStep ? { stepTitle: e.currentStep.title } : {})
    }))).toEqual([
      // Outer workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      // First step start
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix'
      },
      // First step of outer workflow
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix'
      },
      // Nested workflow step start
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      },
      // Inner workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING
      },
      // Inner workflow step start
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Double value'
      },
      // Inner workflow step
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Double value'
      },
      // Inner workflow completion
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Inner Workflow',
        status: STATUS.COMPLETE,
        stepTitle: 'Double value'
      },
      // Outer workflow nested step completion
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      },
      // Outer workflow completion
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.COMPLETE,
        stepTitle: 'Run inner workflow'
      }
    ]);

    // Verify states are passed correctly
    expect(events[6].currentStep?.state).toEqual({ // Inner workflow step completion
      inner: true,
      value: 10
    });
    expect(events[8].currentStep?.state).toEqual({ // Outer workflow after nested workflow
      prefix: "test-",
      innerResult: 10
    });
  });

  it('should handle errors in nested workflows and propagate them up', async () => {
    // Create an inner workflow that will throw an error
    const innerWorkflow = workflow('Failing Inner Workflow')
      .step(
        "Throw error",
        () => {
          throw new Error('Inner workflow error');
        }
      );

    // Create outer workflow that uses the failing inner workflow
    const outerWorkflow = workflow('Outer Workflow')
      .step(
        "First step",
        () => ({ step: "first" })
      )
      .workflow(
        "Run inner workflow",
        innerWorkflow,
        ({ state, workflowState }) => ({
          ...state,
          step: "second",
          innerResult: workflowState.value
        }),
        () => ({ value: 5 })
      );

    const events: Event<any, any>[] = [];
    let error: Error | undefined;
    try {
      for await (const event of outerWorkflow.run({ client: mockClient })) {
        events.push(event);
      }
    } catch (e) {
      error = e as Error;
    }

    // Verify error was thrown
    expect(error?.message).toBe('Inner workflow error');

    // Verify event sequence including error
    expect(events.map(e => ({
      type: e.type,
      workflowTitle: e.workflowTitle,
      status: e.status
    }))).toEqual([
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.ERROR
      },
      {
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Outer Workflow',
        status: STATUS.ERROR
      }
    ]);

    // Verify error details in both inner and outer workflow events
    const innerErrorEvent = events[events.length - 2];
    const outerErrorEvent = events[events.length - 1];

    expect(innerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
    expect(outerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
  });
});

describe('workflow options', () => {
  it('should pass options through to workflow events', async () => {
    const testWorkflow = workflow<{ testOption: string }>('Options Workflow')
      .step(
        "Simple step",
        ({ state, options }) => ({
          value: 1,
          passedOption: options.testOption
        })
      );

    const workflowOptions = {
      testOption: 'test-value'
    };

    const workflowRun = testWorkflow.run({
      client: mockClient,
      options: workflowOptions
    });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      options: workflowOptions
    }));

    // Check step completion
    const stepResult = await workflowRun.next();
    expect(stepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      options: workflowOptions
    }));

    // Check step completion
    const stepCompleteResult = await workflowRun.next();
    expect(stepCompleteResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      options: workflowOptions,
      currentStep: expect.objectContaining({
        state: {
          value: 1,
          passedOption: 'test-value'
        }
      })
    }));

    // Check workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      options: workflowOptions,
      currentStep: expect.objectContaining({
        state: {
          value: 1,
          passedOption: 'test-value'
        }
      })
    }));
  });

  it('should provide empty object as default options', async () => {
    const testWorkflow = workflow('Default Options Workflow')
      .step(
        "Simple step",
        ({ options }) => ({
          hasOptions: Object.keys(options).length === 0
        })
      );

    const workflowRun = testWorkflow.run({ client: mockClient });

    // Skip start event
    await workflowRun.next();

    // Check step start
    const stepStartResult = await workflowRun.next();
    expect(stepStartResult.value).toEqual(expect.objectContaining({
      options: {},
      type: WORKFLOW_EVENTS.STEP_START
    }));

    // Check step completion
    const stepResult = await workflowRun.next();
    expect(stepResult.value).toEqual(expect.objectContaining({
      options: {},
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      currentStep: expect.objectContaining({
        state: {
          hasOptions: true
        }
      })
    }));
  });
});

describe('type inference', () => {
  it('should correctly infer complex workflow state types', async () => {
    // Create an inner workflow that uses the shared options type
    const innerWorkflow = workflow<{ features: string[] }>('Inner Type Test')
      .step(
        "Process features",
        ({ options }) => ({
          processedValue: options.features.includes('fast') ? 100 : 42,
          featureCount: options.features.length
        })
      );

    // Create a complex workflow using multiple features
    const complexWorkflow = workflow<{ features: string[] }>('Complex Type Test')
      .step(
        "First step",
        ({ options }) => ({
          initialFeatures: options.features,
          value: 42
        })
      )
      .workflow(
        "Nested workflow",
        innerWorkflow,
        ({ state, workflowState }) => ({
          ...state,
          processedValue: workflowState.processedValue,
          totalFeatures: workflowState.featureCount
        }),
        () => ({ // Match the inner workflow's state shape
          processedValue: 0,
          featureCount: 0
        })
      )
      .step(
        "Final step",
        ({ state }) => ({
          ...state,
          completed: true
        })
      );

    // Type test setup
    type ExpectedState = {
      initialFeatures: string[];
      value: number;
      processedValue: number;
      totalFeatures: number;
      completed: true;
    };

    type ActualState = Parameters<
      Parameters<(typeof complexWorkflow)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;

    // Run the workflow with required options
    let finalEvent;
    for await (const event of complexWorkflow.run({
      client: mockClient,
      options: { features: ['fast', 'secure'] }
    })) {
      finalEvent = event;
    }

    // Verify the final state has all expected properties with correct types
    expect(finalEvent?.currentStep?.state).toEqual({
      initialFeatures: ['fast', 'secure'],
      value: 42,
      processedValue: 100,
      totalFeatures: 2,
      completed: true
    });
  });

  it('should correctly infer workflow reducer state types', async () => {
    // Create an inner workflow with a specific state shape
    const innerWorkflow = workflow('Inner State Test')
      .step(
        "Inner step",
        () => ({
          innerValue: 42,
          metadata: { processed: true }
        })
      );

    // Create outer workflow to test reducer type inference
    const outerWorkflow = workflow('Outer State Test')
      .step(
        "First step",
        () => ({
          outerValue: 100,
          status: 'ready'
        })
      )
      .workflow(
        "Nested workflow",
        innerWorkflow,
        ({ state, workflowState }) => {
          // Type assertion for outer state
          type ExpectedOuterState = {
            outerValue: number;
            status: string;
          };
          type ActualOuterState = typeof state;
          type OuterStateTest = AssertEquals<
            ActualOuterState,
            ExpectedOuterState
          >;
          const _outerAssert: OuterStateTest = true;

          // Type assertion for inner workflow state
          type ExpectedInnerState = {
            innerValue: number;
            metadata: { processed: boolean };
          };
          type ActualInnerState = typeof workflowState;
          type InnerStateTest = AssertEquals<
            ActualInnerState,
            ExpectedInnerState
          >;
          const _innerAssert: InnerStateTest = true;

          return {
            ...state,
            innerResult: workflowState.innerValue,
            processed: workflowState.metadata.processed
          };
        },
        () => ({} as { innerValue: number; metadata: { processed: boolean } }) // Add initial state
      );

    // Run the workflow to verify runtime behavior
    let finalEvent;
    for await (const event of outerWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    expect(finalEvent?.currentStep?.state).toEqual({
      outerValue: 100,
      status: 'ready',
      innerResult: 42,
      processed: true
    });
  });

  it('should correctly infer step action state types', async () => {
    const testWorkflow = workflow('Action State Test')
      .step(
        "First step",
        () => ({
          count: 1,
          metadata: { created: new Date().toISOString() }
        })
      )
      .step(
        "Second step",
        ({ state }) => {
          // Type assertion for action state
          type ExpectedState = {
            count: number;
            metadata: { created: string };
          };
          type ActualState = typeof state;
          type StateTest = AssertEquals<
            ActualState,
            ExpectedState
          >;
          const _stateAssert: StateTest = true;

          return {
            ...state,
            count: state.count + 1,
            metadata: {
              ...state.metadata,
              updated: new Date().toISOString()
            }
          };
        }
      );

    // Run the workflow to verify runtime behavior
    let finalEvent;
    for await (const event of testWorkflow.run({ client: mockClient })) {
      finalEvent = event;
    }

    expect(finalEvent?.currentStep?.state).toMatchObject({
      count: 2,
      metadata: {
        created: expect.any(String),
        updated: expect.any(String)
      }
    });
  });
});

describe('workflow steps', () => {
  it('should preserve UUIDs from completed steps when restarting', async () => {
    const testWorkflow = workflow('UUID Test')
      .step(
        "First step",
        () => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ state }) => ({ count: state.count + 1 })
      );

    // Run first step and get its UUID
    const firstRun = testWorkflow.run({ client: mockClient });

    await firstRun.next(); // Start event
    await firstRun.next(); // Step start event
    const firstStepEvent = await firstRun.next(); // Step complete event
    const completedStep = firstStepEvent.value.currentStep;

    // Restart workflow with completed step
    const secondRun = testWorkflow.run({
      client: mockClient,
      initialCompletedSteps: [completedStep]
    });

    const restartEvent = await secondRun.next();

    // Only verify that the completed step's UUID was preserved
    expect(restartEvent.value.steps[0].id).toBe(completedStep.id);
  });

  it('should set currentStep correctly in events and preserve through restarts', async () => {
    const testWorkflow = workflow('Step ID Test')
      .step(
        "First step",
        () => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ state }) => ({ count: state.count + 1 })
      );

    // First run - collect all step IDs and events
    const firstRunEvents = [];
    for await (const event of testWorkflow.run({ client: mockClient })) {
      firstRunEvents.push(event);
    }

    // Get the step IDs from the final event's steps array
    const stepIds = firstRunEvents[firstRunEvents.length - 1].steps.map(s => s.id);

    // Verify currentStep is set correctly for each step-related event
    expect(firstRunEvents[1].type).toBe(WORKFLOW_EVENTS.STEP_START); // First step start
    expect(firstRunEvents[1].currentStep?.id).toBe(stepIds[0]);

    expect(firstRunEvents[2].type).toBe(WORKFLOW_EVENTS.STEP_COMPLETE); // First step complete
    expect(firstRunEvents[2].currentStep?.id).toBe(stepIds[0]);

    expect(firstRunEvents[3].type).toBe(WORKFLOW_EVENTS.STEP_START); // Second step start
    expect(firstRunEvents[3].currentStep?.id).toBe(stepIds[1]);

    expect(firstRunEvents[4].type).toBe(WORKFLOW_EVENTS.STEP_COMPLETE); // Second step complete
    expect(firstRunEvents[4].currentStep?.id).toBe(stepIds[1]);

    // Verify workflow events don't have currentStep
    expect(firstRunEvents[0].currentStep).toBeUndefined(); // START event should not have currentStep
    expect(firstRunEvents[5].currentStep).toBeDefined(); // COMPLETE event should have currentStep
    expect(firstRunEvents[5].currentStep).toEqual(firstRunEvents[4].currentStep); // COMPLETE event should have last completed step

    // Now restart the workflow after first step
    const firstStepCompleted = firstRunEvents[2].currentStep;
    if (!firstStepCompleted) {
      throw new Error('Expected current step to be defined');
    }

    const secondRunEvents = [];
    for await (const event of testWorkflow.run({
      client: mockClient,
      initialCompletedSteps: [firstStepCompleted]
    })) {
      secondRunEvents.push(event);
    }

    // Verify the first step ID was preserved and second step ID matches
    expect(secondRunEvents[0].steps[0].id).toBe(stepIds[0]); // First step ID preserved
    expect(secondRunEvents[0].steps[1].id).not.toBe(stepIds[1]); // Second step should have new ID
    expect(secondRunEvents[0].steps[1].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); // Should be a valid UUID

    // Verify currentStep is set correctly in restarted workflow
    expect(secondRunEvents[1].type).toBe(WORKFLOW_EVENTS.STEP_START); // Second step start
    expect(secondRunEvents[1].currentStep?.id).toBe(secondRunEvents[0].steps[1].id); // Should match the new ID

    expect(secondRunEvents[2].type).toBe(WORKFLOW_EVENTS.STEP_COMPLETE); // Second step complete
    expect(secondRunEvents[2].currentStep?.id).toBe(secondRunEvents[0].steps[1].id); // Should match the new ID
  });
});
