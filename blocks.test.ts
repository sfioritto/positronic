import { workflow } from './dsl/blocks';
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
