import { WORKFLOW_EVENTS, STATUS } from './constants.js';
import { applyPatches} from './json-patch.js';
import { State } from './types.js';
import { workflow, type WorkflowEvent, type WorkflowErrorEvent, type SerializedStep, type SerializedStepStatus } from './workflow.js';
import { z } from 'zod';
import { nextStep } from '../../../../test-utils.js';
import { ResourceLoader } from '@positronic/resources/src/types.js';

// Define a Logger interface for testing
interface Logger {
  log: (message: string) => void;
}

class TestResourceLoader implements ResourceLoader {
  private files: Map<string, string> = new Map();

  setFile(path: string, content: string) {
    this.files.set(path, content);
  }

  async load(path: string, type?: 'text' | 'image' | 'binary'): Promise<string | Buffer> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }
}

// Mock services for testing
const testLogger: Logger = {
  log: jest.fn()
};

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
        () => {
          return { count: 1 };
        }
      )
      .step(
        "Second step",
        ({ state }) => ({ ...state, doubled: state.count * 2 })
      );

    const workflowRun = testWorkflow.run({ client: mockClient });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'test workflow',
      workflowDescription: undefined
    }));

    // Skip initial step status event
    await nextStep(workflowRun);

    // Check first step start
    const firstStepStartResult = await nextStep(workflowRun);
    expect(firstStepStartResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      stepTitle: 'First step',
      stepId: expect.any(String)
    }));

    // Check first step completion
    const firstStepResult = await nextStep(workflowRun);
    expect(firstStepResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      status: STATUS.RUNNING,
      stepTitle: 'First step',
      stepId: expect.any(String),
      patch: [{
        op: 'add',
        path: '/count',
        value: 1
      }]
    }));

    // Step Status Event
    await nextStep(workflowRun);

    // Check second step start
    const secondStepStartResult = await nextStep(workflowRun);
    expect(secondStepStartResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      stepTitle: 'Second step',
      stepId: expect.any(String)
    }));

    // Check second step completion
    const secondStepResult = await nextStep(workflowRun);
    expect(secondStepResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      stepTitle: 'Second step',
      stepId: expect.any(String),
      patch: [{
        op: 'add',
        path: '/doubled',
        value: 2
      }]
    }));

    // Step Status Event
    const stepStatusResult = await nextStep(workflowRun);
    expect(stepStatusResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_STATUS,
      steps: [
        expect.objectContaining({
          title: 'First step',
          status: STATUS.COMPLETE,
          id: expect.any(String)
        }),
        expect.objectContaining({
          title: 'Second step',
          status: STATUS.COMPLETE,
          id: expect.any(String)
        })
      ]
    }));

    // Check workflow completion
    const completeResult = await nextStep(workflowRun);
    expect(completeResult).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      workflowTitle: 'test workflow',
      workflowDescription: undefined,
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
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'my named workflow',
      workflowDescription: 'some description',
      options: {}
    }));
  });

  it('should create a workflow with just a name when passed a string', async () => {
    const testWorkflow = workflow('simple workflow');
    const workflowRun = testWorkflow.run({ client: mockClient });
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'simple workflow',
      workflowDescription: undefined,
      options: {}
    }));
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

    // Run the workflow and capture all events
    const events = [];
    let finalState = {};
    for await (const event of testWorkflow.run({ client: mockClient })) {
      events.push(event);
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Final state should include both responses
    expect(finalState).toEqual({
      overrideResponse: { override: true }
    });

    // Verify that each client was used correctly based on the supplied prompt configuration.
    expect(mockClient.execute).toHaveBeenCalledWith("prompt1", expect.any(Object));
    expect(overrideClient.execute).toHaveBeenCalledWith("prompt2", expect.any(Object));
  });

  it('should use the provided workflowRunId for the initial run if supplied', async () => {
    const testWorkflow = workflow('Workflow with Provided ID');
    const providedId = 'my-custom-run-id-123';

    const workflowRun = testWorkflow.run({ client: mockClient, workflowRunId: providedId });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'Workflow with Provided ID',
      workflowRunId: providedId // Expect the provided ID here
    }));
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

    let errorEvent, finalStepStatusEvent;
    try {
      for await (const event of errorWorkflow.run({ client: mockClient })) {
        if (event.type === WORKFLOW_EVENTS.ERROR) {
          errorEvent = event;
        }
        if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
          finalStepStatusEvent = event;
        }
      }
    } catch (error) {
      // Error is expected to be thrown
    }

    // Verify final state
    expect(errorEvent?.status).toBe(STATUS.ERROR);
    expect(errorEvent?.error?.message).toBe('Test error');

    // Verify steps status
    if (!finalStepStatusEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalStepStatusEvent.steps[0].status).toBe(STATUS.COMPLETE);
    expect(finalStepStatusEvent.steps[1].status).toBe(STATUS.ERROR);
    expect(finalStepStatusEvent.steps[2].status).toBe(STATUS.PENDING);

    // Verify error event structure
    expect(errorEvent).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.ERROR,
      status: STATUS.ERROR,
      workflowTitle: 'Error Workflow',
      error: expect.objectContaining({
        name: expect.any(String),
        message: expect.any(String)
      }),
    }));
  });

  it('should handle errors in nested workflows and propagate them up', async () => {
    // Create an inner workflow that will throw an error
    const innerWorkflow = workflow<{}, { inner?: boolean, value?: number }>('Failing Inner Workflow')
      .step(
        "Throw error",
        (): { value: number } => {
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

    const events: WorkflowEvent<any>[] = [];
    let error: Error | undefined;
    let mainWorkflowId: string | undefined;

    try {
      for await (const event of outerWorkflow.run({ client: mockClient })) {
        events.push(event);
        if (event.type === WORKFLOW_EVENTS.START && !mainWorkflowId) {
          mainWorkflowId = event.workflowRunId;
        }
      }
    } catch (e) {
      error = e as Error;
    }

    // Verify error was thrown
    expect(error?.message).toBe('Inner workflow error');

    // Verify event sequence including error
    expect(events).toEqual([
      expect.objectContaining({
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        workflowRunId: mainWorkflowId
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'First step'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: 'First step'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.RUNNING,
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Throw error'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String)
        }),
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Throw error',
            status: STATUS.ERROR
          })
        ])
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Outer Workflow',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String)
        })
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Run inner workflow',
            status: STATUS.ERROR
          })
        ])
      })
    ]);

    // Find inner and outer error events by workflowRunId
    const innerErrorEvent = events.find(e =>
      e.type === WORKFLOW_EVENTS.ERROR &&
      e.workflowRunId !== mainWorkflowId
    ) as WorkflowErrorEvent<any>;

    const outerErrorEvent = events.find(e =>
      e.type === WORKFLOW_EVENTS.ERROR &&
      e.workflowRunId === mainWorkflowId
    ) as WorkflowErrorEvent<any>;

    expect(innerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
    expect(outerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
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

    const events = [];
    let finalState = {};
    for await (const event of testWorkflow.run({ client: mockClient })) {
      events.push(event);
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, event.patch);
      }
    }

    // Skip checking events[0] (workflow:start)
    // Skip checking events[1] (step:status)

    // Verify the step start event
    expect(events[2]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      stepTitle: 'Simple step',
      stepId: expect.any(String),
      options: {}
    }));

    // Verify the step complete event
    expect(events[3]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      status: STATUS.RUNNING,
      stepTitle: 'Simple step',
      stepId: expect.any(String),
      patch: [{
        op: 'add',
        path: '/count',
        value: 1
      }, {
        op: 'add',
        path: '/message',
        value: 'Count is now 1'
      }],
      options: {}
    }));

    expect(events[4]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_STATUS,
      steps: [
        expect.objectContaining({ title: 'Simple step', status: STATUS.COMPLETE, id: expect.any(String) })
      ],
      options: {}
    }));

    // Verify the workflow complete event
    expect(events[5]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      workflowTitle: 'Simple Workflow',
      options: {}
    }));

    // Verify the final state
    expect(finalState).toEqual({
      count: 1,
      message: 'Count is now 1'
    });
  });

  it('should maintain immutable results between steps', async () => {
    const testWorkflow = workflow('Immutable Steps Workflow')
      .step("First step", () => ({
        value: 1
      }))
      .step("Second step", ({ state }) => {
        // Attempt to modify previous step's state
        state.value = 99;
        return {
          value: 2
        };
      });

    let finalState = {};
    const patches = [];
    for await (const event of testWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        patches.push(...event.patch);
      }
    }

    // Apply all patches to the initial state
    finalState = applyPatches(finalState, patches);

    // Verify the final state
    expect(finalState).toEqual({ value: 2 });
  });
});

describe('workflow resumption', () => {
  const mockClient = {
    execute: jest.fn()
  };

  it('should resume workflow from the correct step when given initialCompletedSteps', async () => {
    const executedSteps: string[] = [];
    const threeStepWorkflow = workflow('Three Step Workflow')
      .step("Step 1", ({ state }) => {
        executedSteps.push("Step 1");
        return { ...state, value: 2 };
      })
      .step("Step 2", ({ state }) => {
        executedSteps.push("Step 2");
        return { ...state, value: state.value + 10 };
      })
      .step("Step 3", ({ state }) => {
        executedSteps.push("Step 3");
        return { ...state, value: state.value * 3 };
      });

    // First run to get the first step completed with initial state
    let initialCompletedSteps: SerializedStep[] = []; // Use the correct type
    const initialState = { initialValue: true };
    let firstStepState: State = initialState;
    let allStepsInfo: SerializedStepStatus[] = []; // Explicit type annotation needed

    // Run workflow until we get the first step completed
    for await (const event of threeStepWorkflow.run({
      client: mockClient,
      initialState,
    })) {
      // Capture the full step list from the first status event
      if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        allStepsInfo = event.steps; // Direct assignment, type is SerializedStepStatus[]
      }

      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE && event.stepTitle === "Step 1") {
        firstStepState = applyPatches(firstStepState, [event.patch]);
        // Construct initialCompletedSteps with the full data for completed steps
        initialCompletedSteps = allStepsInfo.map((stepInfo, index) => {
          if (index === 0) { // If it's Step 1
            return { ...stepInfo, status: STATUS.COMPLETE, patch: event.patch };
          } else {
            return { ...stepInfo, status: STATUS.PENDING, patch: undefined };
          }
        });
        break;  // Stop after first step
      }
    }

    // Clear executed steps array
    executedSteps.length = 0;

    // Resume workflow with first step completed
    let resumedState: State | undefined;
    if (!initialCompletedSteps) throw new Error('Expected initialCompletedSteps');

    for await (const event of threeStepWorkflow.run({
      client: mockClient,
      initialState,
      initialCompletedSteps,
      workflowRunId: 'test-run-id',
    })) {
      if (event.type === WORKFLOW_EVENTS.RESTART) {
        resumedState = event.initialState;
      } else if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        resumedState = applyPatches(resumedState!, [event.patch]);
      }
    }

    // Verify only steps 2 and 3 were executed
    expect(executedSteps).toEqual(["Step 2", "Step 3"]);
    expect(executedSteps).not.toContain("Step 1");

    // Verify the final state after all steps complete
    expect(resumedState).toEqual({
      value: 36,
      initialValue: true
    });
  });
});

describe('nested workflows', () => {
  it('should execute nested workflows and yield all inner workflow events', async () => {
    // Create an inner workflow that will be nested
    const innerWorkflow = workflow<{}, { value: number }>('Inner Workflow')
      .step(
        "Double value",
        ({ state }) => ({
          inner: true,
          value: state.value * 2
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

    const events: WorkflowEvent<any>[] = [];
    for await (const event of outerWorkflow.run({ client: mockClient })) {
      events.push(event);
    }

    // Verify all events are yielded in correct order
    expect(events.map(e => ({
      type: e.type,
      workflowTitle: 'workflowTitle' in e ? e.workflowTitle : undefined,
      status: 'status' in e ? e.status : undefined,
      stepTitle: 'stepTitle' in e ? e.stepTitle : undefined
    }))).toEqual([
      // Outer workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: undefined
      },
      // Initial step status for outer workflow
      {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        workflowTitle: undefined,
        status: undefined,
        stepTitle: undefined
      },
      // First step of outer workflow
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix'
      },
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix'
      },
      {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        workflowTitle: undefined,
        status: undefined,
        stepTitle: undefined
      },
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      },
      // Inner workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING,
        stepTitle: undefined
      },
      // Initial step status for inner workflow
      {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        workflowTitle: undefined,
        status: undefined,
        stepTitle: undefined
      },
      // Inner workflow step
      {
        type: WORKFLOW_EVENTS.STEP_START,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Double value'
      },
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Double value'
      },
      {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        workflowTitle: undefined,
        status: undefined,
        stepTitle: undefined
      },
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Inner Workflow',
        status: STATUS.COMPLETE,
        stepTitle: undefined
      },
      // Outer workflow nested step completion
      {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        workflowTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      },
      {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        workflowTitle: undefined,
        status: undefined,
        stepTitle: undefined
      },
      // Outer workflow completion
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.COMPLETE,
        stepTitle: undefined
      }
    ]);

    // Verify states are passed correctly
    let innerState: State = { value: 5 };  // Match the initial state from the workflow
    let outerState = {};

    for (const event of events) {
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        if (event.stepTitle === 'Double value') {
          innerState = applyPatches(innerState, [event.patch]);
        } else {
          outerState = applyPatches(outerState, [event.patch]);
        }
      }
    }

    // Verify final states
    expect(innerState).toEqual({
      inner: true,
      value: 10
    });

    expect(outerState).toEqual({
      prefix: "test-",
      innerResult: 10
    });
  });

  it('should handle errors in nested workflows and propagate them up', async () => {
    // Create an inner workflow that will throw an error
    const innerWorkflow = workflow<{}, { inner: boolean, value: number }>('Failing Inner Workflow')
      .step(
        "Throw error",
        (): { value: number } => {
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

    const events: WorkflowEvent<any>[] = [];
    let error: Error | undefined;
    let mainWorkflowId: string | undefined;

    try {
      for await (const event of outerWorkflow.run({ client: mockClient })) {
        events.push(event);
        if (event.type === WORKFLOW_EVENTS.START && !mainWorkflowId) {
          mainWorkflowId = event.workflowRunId;
        }
      }
    } catch (e) {
      error = e as Error;
    }

    // Verify error was thrown
    expect(error?.message).toBe('Inner workflow error');

    // Verify event sequence including error
    expect(events).toEqual([
      expect.objectContaining({
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        workflowRunId: mainWorkflowId
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'First step'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: 'First step'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.RUNNING,
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.any(Array)
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Throw error'
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Failing Inner Workflow',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String)
        }),
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Throw error',
            status: STATUS.ERROR
          })
        ])
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.ERROR,
        workflowTitle: 'Outer Workflow',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String)
        })
      }),
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Run inner workflow',
            status: STATUS.ERROR
          })
        ])
      })
    ]);

    // Find inner and outer error events by workflowRunId
    const innerErrorEvent = events.find(e =>
      e.type === WORKFLOW_EVENTS.ERROR &&
      e.workflowRunId !== mainWorkflowId
    ) as WorkflowErrorEvent<any>;

    const outerErrorEvent = events.find(e =>
      e.type === WORKFLOW_EVENTS.ERROR &&
      e.workflowRunId === mainWorkflowId
    ) as WorkflowErrorEvent<any>;

    expect(innerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
    expect(outerErrorEvent.error).toEqual(expect.objectContaining({
      message: 'Inner workflow error'
    }));
  });

  it('should include patches in step status events for inner workflow steps', async () => {
    interface InnerState extends State {
      value: number;
    }

    interface OuterState extends State {
      value: number;
      result?: number;
    }

    // Create an inner workflow that modifies state
    const innerWorkflow = workflow<{}, InnerState>('Inner Workflow')
      .step("Double value", ({ state }) => ({
        ...state,
        value: state.value * 2
      }));

    // Create outer workflow that uses the inner workflow
    const outerWorkflow = workflow<{}, OuterState>('Outer Workflow')
      .step("Set initial", () => ({
        value: 5
      }))
      .workflow(
        "Run inner workflow",
        innerWorkflow,
        ({ state, workflowState }) => ({
          ...state,
          result: workflowState.value
        }),
        (state) => ({ value: state.value })
      );

    // Run workflow and collect step status events
    let finalStepStatus;
    for await (const event of outerWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      }
    }

    // Verify step status contains patches for all steps including the inner workflow step
    expect(finalStepStatus?.steps).toEqual([
      expect.objectContaining({
        title: 'Set initial',
        status: STATUS.COMPLETE,
      }),
      expect.objectContaining({
        title: 'Run inner workflow',
        status: STATUS.COMPLETE,
      })
    ]);
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

    let finalEvent, finalStepStatus;
    for await (const event of testWorkflow.run({
      client: mockClient,
      options: workflowOptions,
    })) {
      if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      } else {
        finalEvent = event;
      }
    }

    expect(finalEvent).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      workflowTitle: 'Options Workflow',
      workflowDescription: undefined,
      options: workflowOptions,
    }))
    expect(finalStepStatus).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.STEP_STATUS,
      steps: [
        expect.objectContaining({
          title: 'Simple step',
          status: STATUS.COMPLETE,
        })
      ],
      options: workflowOptions,
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

    // Skip initial step status event
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
      type: WORKFLOW_EVENTS.STEP_COMPLETE,
      stepTitle: 'Simple step',
      options: {},
    }));
  });
});

describe('services support', () => {
  it('should allow adding custom services to workflows', async () => {
    // Create a workflow with services
    const testWorkflow = workflow('Services Test')
      .withServices({
        logger: testLogger
      })
      .step('Use service', ({ state, logger }) => {
        logger.log('Test service called');
        return { serviceUsed: true };
      });

    // Run the workflow and collect events
    let finalState = {};
    for await (const event of testWorkflow.run({
      client: mockClient,
    })) {
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the service was called
    expect(testLogger.log).toHaveBeenCalledWith('Test service called');

    // Verify the state was updated
    expect(finalState).toEqual({ serviceUsed: true });
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
        () => ({
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

    // Collect all events
    const events = [];
    let finalStepStatus, finalState = {};
    let mainWorkflowId: string | undefined;

    for await (const event of complexWorkflow.run({
      client: mockClient,
      options: { features: ['fast', 'secure'] },
    })) {
      events.push(event);

      // Capture the main workflow's ID from its start event
      if (event.type === WORKFLOW_EVENTS.START && !mainWorkflowId) {
        mainWorkflowId = event.workflowRunId;
      }

      if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      } else if (
        event.type === WORKFLOW_EVENTS.STEP_COMPLETE &&
        event.workflowRunId === mainWorkflowId // Only process events from main workflow
      ) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify workflow start event
    expect(events[0]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'Complex Type Test',
      workflowDescription: undefined,
      options: { features: ['fast', 'secure'] },
      workflowRunId: mainWorkflowId
    }));

    // Verify inner workflow events are included
    const innerStartEvent = events.find(e =>
      e.type === WORKFLOW_EVENTS.START &&
      'workflowRunId' in e &&
      e.workflowRunId !== mainWorkflowId
    );
    expect(innerStartEvent).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'Inner Type Test',
      options: { features: ['fast', 'secure'] }
    }));

    // Verify the final step status
    if (!finalStepStatus) throw new Error('Expected final step status event');
    const lastStep = finalStepStatus.steps[finalStepStatus.steps.length - 1];
    expect(lastStep.status).toBe(STATUS.COMPLETE);
    expect(lastStep.title).toBe('Final step');

    expect(finalState).toEqual({
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
            metadata: { processed: true };
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
        () => ({} as { innerValue: number; metadata: { processed: boolean } })
      );

    // Run the workflow to verify runtime behavior
    let finalState = {};
    let mainWorkflowId: string | undefined;

    for await (const event of outerWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.START && !mainWorkflowId) {
        mainWorkflowId = event.workflowRunId;
      }
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE && event.workflowRunId === mainWorkflowId) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toEqual({
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
    let finalState = {};
    let mainWorkflowId: string | undefined;

    for await (const event of testWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.START && !mainWorkflowId) {
        mainWorkflowId = event.workflowRunId;
      }
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE && event.workflowRunId === mainWorkflowId) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toMatchObject({
      count: 2,
      metadata: {
        created: expect.any(String),
        updated: expect.any(String)
      }
    });
  });

  it('should correctly infer prompt response types in subsequent steps', async () => {
    const testWorkflow = workflow('Prompt Type Test')
      .prompt(
        "Get user info",
        {
          template: () => "What is the user's info?",
          responseModel: {
            schema: z.object({ name: z.string(), age: z.number() }),
            name: "userInfo" as const  // Must be const or type inference breaks
          }
        }
      )
      .step(
        "Use response",
        ({ state }) => {
          // Type assertion to verify state includes userInfo
          type ExpectedState = {
            userInfo: {
              name: string;
              age: number;
            }
          };
          type ActualState = typeof state;
          type StateTest = AssertEquals<ActualState, ExpectedState>;
          const _stateAssert: StateTest = true;

          return {
            ...state,
            greeting: `Hello ${state.userInfo.name}, you are ${state.userInfo.age} years old`
          };
        }
      );

    // Mock the client response
    mockClient.execute.mockResolvedValueOnce({
      name: "Test User",
      age: 30
    });

    // Run workflow and collect final state
    let finalState = {};
    for await (const event of testWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the workflow executed correctly
    expect(finalState).toEqual({
      userInfo: {
        name: "Test User",
        age: 30
      },
      greeting: "Hello Test User, you are 30 years old"
    });
  });

  it('should correctly handle prompt reduce function', async () => {
    const testWorkflow = workflow('Prompt Reduce Test')
      .prompt(
        "Get numbers",
        {
          template: () => "Give me some numbers",
          responseModel: {
            schema: z.object({ numbers: z.array(z.number()) }),
            name: "numbersResponse" as const
          }
        },
        ({ state, response, options }) => ({
          ...state,
          numbersResponse: response,  // Include the response explicitly
          sum: response.numbers.reduce((a, b) => a + b, 0),
          count: response.numbers.length
        })
      );

    // Mock the client response
    mockClient.execute.mockResolvedValueOnce({
      numbers: [1, 2, 3, 4, 5]
    });

    // Run workflow and collect final state
    let finalState = {};
    for await (const event of testWorkflow.run({ client: mockClient })) {
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the workflow executed correctly with reduced state
    expect(finalState).toEqual({
      numbersResponse: {
        numbers: [1, 2, 3, 4, 5]
      },
      sum: 15,
      count: 5
    });

    // Verify type inference works correctly
    type ExpectedState = {
      numbersResponse: {
        numbers: number[];
      };
      sum: number;
      count: number;
    };

    type ActualState = Parameters<
      Parameters<(typeof testWorkflow)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;
  });
});
