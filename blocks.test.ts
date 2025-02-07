import { workflow, type Event } from './dsl/blocks';
import { WORKFLOW_EVENTS, STATUS } from './dsl/constants';

// Mock PromptClient for testing
const mockClient = {
  execute: jest.fn()
};

describe('workflow creation', () => {
  it('should create a workflow with steps and run through them', async () => {
    const testWorkflow = workflow('test workflow', mockClient)
      .step(
        "First step",
        () => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ context }) => ({ count: context.count, doubled: context.count * 2 })
      );

    const workflowRun = testWorkflow.run({ options: {} });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'test workflow',
      previousContext: {},
      newContext: {}
    }));

    // Check first step completion
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { count: 1 },
      completedStep: expect.objectContaining({
        title: 'First step',
        status: STATUS.COMPLETE,
        context: { count: 1 }
      })
    }));

    // Check second step completion
    const secondStepResult = await workflowRun.next();
    expect(secondStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { count: 1, doubled: 2 },
      completedStep: expect.objectContaining({
        title: 'Second step',
        status: STATUS.COMPLETE,
        context: { count: 1, doubled: 2 }
      })
    }));

    // Check workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      previousContext: {},
      newContext: { count: 1, doubled: 2 }
    }));
  });

  it('should create a workflow with a name and description when passed an object', async () => {
    const testWorkflow = workflow({
      title: 'my named workflow',
      description: 'some description'
    }, mockClient);

    const workflowRun = testWorkflow.run({ options: {} });
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      workflowTitle: 'my named workflow',
      workflowDescription: 'some description',
      type: WORKFLOW_EVENTS.START
    }));
  });

  it('should create a workflow with just a name when passed a string', async () => {
    const testWorkflow = workflow('simple workflow', mockClient);
    const workflowRun = testWorkflow.run({ options: {} });
    const startResult = await workflowRun.next();
    const event = startResult.value;
    if (!event) throw new Error('Expected event');

    expect(event).toEqual(expect.objectContaining({
      workflowTitle: 'simple workflow',
      type: WORKFLOW_EVENTS.START
    }));
    expect(event.workflowDescription).toBeUndefined();
  });
});

describe('error handling', () => {
  it('should handle errors in actions and maintain correct status', async () => {
    const errorWorkflow = workflow('Error Workflow', mockClient)
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
      .step("Never reached", ({ context }) => ({
        value: context.value + 1
      }));

    let finalEvent;
    try {
      for await (const event of errorWorkflow.run({ options: {} })) {
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
  it('should create a step that updates context', async () => {
    const testWorkflow = workflow('Simple Workflow', mockClient)
      .step("Simple step", ({ context }) => ({
        ...context,
        count: 1,
        message: 'Count is now 1'
      }));

    let finalEvent;
    for await (const event of testWorkflow.run({ options: {} })) {
      finalEvent = event;
    }

    // Verify the step executed correctly
    expect(finalEvent?.status).toBe(STATUS.COMPLETE);
    expect(finalEvent?.newContext).toEqual({
      count: 1,
      message: 'Count is now 1'
    });
  });

  it('should not modify the original context when step mutates context', async () => {
    const originalContext = {
      value: 1,
      nested: { count: 0 }
    };

    const testWorkflow = workflow<{}, { value: number; nested: { count: number } }>('Mutation Test Workflow', mockClient)
      .step("Mutating step", ({ context }) => {
        // Attempt to mutate the input context
        context.value = 99;
        context.nested = { count: 99 };
        return context;
      });

    let finalEvent;
    for await (const event of testWorkflow.run({
      initialContext: originalContext,
      options: {}
    })) {
      finalEvent = event;
    }

    // Verify original context remains unchanged
    expect(originalContext).toEqual({
      value: 1,
      nested: { count: 0 }
    });
  });

  it('should maintain immutable results between steps', async () => {
    const testWorkflow = workflow('Immutable Steps Workflow', mockClient)
      .step("First step", () => ({
        value: 1
      }))
      .step("Second step", ({ context }) => {
        // Attempt to modify previous step's context
        context.value = 99;
        return {
          value: 2
        };
      });

    let finalEvent;
    for await (const event of testWorkflow.run({ options: {} })) {
      finalEvent = event;
    }

    // Verify that modifications didn't persist
    if (!finalEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalEvent.steps[0].context).toEqual({ value: 1 });
    expect(finalEvent.steps[1].context).toEqual({ value: 2 });
  });
});

describe('workflow resumption', () => {
  // Mock client setup
  const mockClient = {
    execute: jest.fn()
  };

  it('should resume workflow from a specific step with correct context chain', async () => {
    const threeStepWorkflow = workflow('Three Step Workflow', mockClient)
      .step("Step 1: Double", ({ context }) => ({
        value: ((context as { value: number }).value || 2) * 2
      }))
      .step("Step 2: Add 10", ({ context }) => ({
        value: context.value + 10
      }))
      .step("Step 3: Multiply by 3", ({ context }) => ({
        value: context.value * 3
      }));

    const initialContext = { value: 2 };

    // First run the workflow normally
    let fullRun;
    for await (const event of threeStepWorkflow.run({
      initialContext,
      options: {}
    })) {
      fullRun = event;
    }

    if (!fullRun?.steps) {
      throw new Error('Steps not found');
    }

    // Resume from step 2 by passing the completed first step
    let resumedRun;
    for await (const event of threeStepWorkflow.run({
      initialContext,
      options: {},
      initialCompletedSteps: [fullRun.steps[0]]
    })) {
      resumedRun = event;
    }

    // Verify the full run executed correctly
    expect(fullRun.newContext.value).toBe(42); // ((2 * 2) + 10) * 3 = 42
    expect(fullRun.steps.map(s => s.context.value)).toEqual([4, 14, 42]);

    // Verify the resumed run started from step 2 with correct context
    expect(resumedRun?.newContext.value).toBe(42);
    expect(resumedRun?.steps.slice(1).map(s => s.context.value)).toEqual([14, 42]);
  });
});

describe('nested workflows', () => {
  it('should execute nested workflows and yield all inner workflow events', async () => {
    // Create an inner workflow that will be nested
    const innerWorkflow = workflow('Inner Workflow', mockClient)
      .step(
        "Double value",
        ({ context }) => ({
          inner: true,
          value: (context as any).value * 2
        })
      );

    // Create outer workflow that uses the inner workflow
    const outerWorkflow = workflow('Outer Workflow', mockClient)
      .step(
        "Set prefix",
        () => ({ prefix: "test-" })
      )
      .workflow(
        "Run inner workflow",
        innerWorkflow,
        ({ context, workflowContext }) => ({
          ...context,
          innerResult: workflowContext.value
        }),
        () => ({ value: 5 })
      );

    const events: Event<any, any, any>[] = [];
    for await (const event of outerWorkflow.run({ options: {} })) {
      events.push(event);
    }

    // Verify all events are yielded in correct order
    expect(events.map(e => ({
      type: e.type,
      workflowTitle: e.workflowTitle,
      status: e.status,
      ...(e.completedStep ? { stepTitle: e.completedStep.title } : {})
    }))).toEqual([
      // Outer workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      // First step of outer workflow
      {
        type: WORKFLOW_EVENTS.UPDATE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix'
      },
      // Inner workflow start
      {
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING
      },
      // Inner workflow step
      {
        type: WORKFLOW_EVENTS.UPDATE,
        workflowTitle: 'Inner Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Double value'
      },
      // Inner workflow completion
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Inner Workflow',
        status: STATUS.COMPLETE
      },
      // Outer workflow nested step completion
      {
        type: WORKFLOW_EVENTS.UPDATE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING,
        stepTitle: 'Run inner workflow'
      },
      // Outer workflow completion
      {
        type: WORKFLOW_EVENTS.COMPLETE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.COMPLETE
      }
    ]);

    // Verify contexts are passed correctly
    expect(events[3].newContext).toEqual({ // Inner workflow step completion
      inner: true,
      value: 10
    });
    expect(events[5].newContext).toEqual({ // Outer workflow after nested workflow
      prefix: "test-",
      innerResult: 10
    });
  });

  it('should handle errors in nested workflows and propagate them up', async () => {
    // Create an inner workflow that will throw an error
    const innerWorkflow = workflow('Failing Inner Workflow', mockClient)
      .step(
        "Throw error",
        () => {
          throw new Error('Inner workflow error');
        }
      );

    // Create outer workflow that uses the failing inner workflow
    const outerWorkflow = workflow('Outer Workflow', mockClient)
      .step(
        "First step",
        () => ({ step: "first" })
      )
      .workflow(
        "Run inner workflow",
        innerWorkflow,
        ({ context, workflowContext }) => ({
          ...context,
          step: "second",
          innerResult: workflowContext.value
        }),
        () => ({ value: 5 })
      );

    const events: Event<any, any>[] = [];
    let error: Error | undefined;
    try {
      for await (const event of outerWorkflow.run({ options: {} })) {
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
        type: WORKFLOW_EVENTS.UPDATE,
        workflowTitle: 'Outer Workflow',
        status: STATUS.RUNNING
      },
      {
        type: WORKFLOW_EVENTS.START,
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
    const testWorkflow = workflow<{ testOption: string }>('Options Workflow', mockClient)
      .step(
        "Simple step",
        ({ context, options }) => ({
          value: (context as any).value + 1,
          passedOption: options.testOption
        })
      );

    const workflowOptions = {
      testOption: 'test-value'
    };

    const workflowRun = testWorkflow.run({
      initialContext: { value: 1, passedOption: '' },
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
      type: WORKFLOW_EVENTS.UPDATE,
      options: workflowOptions,
      newContext: {
        value: 2,
        passedOption: 'test-value'
      }
    }));

    // Check workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      options: workflowOptions,
      newContext: {
        value: 2,
        passedOption: 'test-value'
      }
    }));
  });

  it('should provide empty object as default options', async () => {
    const testWorkflow = workflow('Default Options Workflow', mockClient)
      .step(
        "Simple step",
        ({ options }) => ({
          hasOptions: Object.keys(options).length === 0
        })
      );

    const workflowRun = testWorkflow.run({
      initialContext: { hasOptions: false },
      options: {}
    });

    // Skip start event
    await workflowRun.next();

    // Check step completion
    const stepResult = await workflowRun.next();
    expect(stepResult.value).toEqual(expect.objectContaining({
      options: {},
      newContext: {
        hasOptions: true
      }
    }));
  });
});
