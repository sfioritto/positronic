import { createWorkflow, Event } from './dsl/new-dsl';
import { WORKFLOW_EVENTS, STATUS } from './dsl/constants';
import { JsonObject } from './dsl/types';

type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

describe('workflow creation', () => {
  it('should create a workflow with steps and run through them', async () => {
    const workflow = createWorkflow('test workflow')
      .step(
        "First step",
        () => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ context }) => ({ count: context.count, doubled: context.count * 2 })
      );

    const workflowRun = workflow.run({});

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
    const workflow = createWorkflow({
      title: 'my named workflow',
      description: 'some description'
    });

    const workflowRun = workflow.run({});
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      workflowTitle: 'my named workflow',
      workflowDescription: 'some description',
      type: WORKFLOW_EVENTS.START
    }));
  });

  it('should create a workflow with just a name when passed a string', async () => {
    const workflow = createWorkflow('simple workflow');
    const workflowRun = workflow.run({});
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
    const errorWorkflow = createWorkflow('Error Workflow')
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
    for await (const event of errorWorkflow.run()) {
      finalEvent = event;
    }

    // Verify final state
    expect(finalEvent?.status).toBe('error');
    expect(finalEvent?.error?.message).toBe('Test error');

    // Verify steps status
    if (!finalEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalEvent.steps[0].status).toBe('complete');
    expect(finalEvent.steps[1].status).toBe('error');
    expect(finalEvent.steps[2].status).toBe('pending');
  });
});

describe('step creation', () => {
  it('should create a step that updates context', async () => {
    const workflow = createWorkflow('Simple Workflow')
      .step("Simple step", ({ context }) => ({
        ...context,
        count: 1,
        message: 'Count is now 1'
      }));

    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    // Verify the step executed correctly
    expect(finalEvent?.status).toBe('complete');
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

    const workflow = createWorkflow('Mutation Test Workflow')
      .step("Mutating step", ({ context }) => {
        // Attempt to mutate the input context
        context.value = 99;
        context.nested = { count: 99 };
        return context;
      });

    let finalEvent;
    for await (const event of workflow.run({ initialContext: originalContext })) {
      finalEvent = event;
    }

    // Verify original context remains unchanged
    expect(originalContext).toEqual({
      value: 1,
      nested: { count: 0 }
    });
  });

  it('should maintain immutable results between steps', async () => {
    const workflow = createWorkflow('Immutable Steps Workflow')
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
    for await (const event of workflow.run()) {
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
  it('should resume workflow from a specific step with correct context chain', async () => {
    const threeStepWorkflow = createWorkflow('Three Step Workflow')
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
    for await (const event of threeStepWorkflow.run({ initialContext })) {
      fullRun = event;
    }

    if (!fullRun?.steps) {
      throw new Error('Steps not found');
    }

    // Resume from step 2 by passing the completed first step
    let resumedRun;
    for await (const event of threeStepWorkflow.run({
      initialContext,
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
  it('should execute nested workflows with proper context flow', async () => {
    // Create an inner workflow that will be nested
    const innerWorkflow = createWorkflow('Inner Workflow')
      .step(
        "Double value",
        ({ context }) => ({
          inner: true,
          value: (context as any).value * 2
        })
      );

    // Create outer workflow that uses the inner workflow
    const outerWorkflow = createWorkflow('Outer Workflow')
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
        () => ({ value: 5 }),
      );

    const workflowRun = outerWorkflow.run({ initialContext: { prefix: "" } });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      workflowTitle: 'Outer Workflow',
    }));

    // Check first step completion (Set prefix)
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { prefix: "test-" },
      completedStep: expect.objectContaining({
        title: 'Set prefix',
        status: STATUS.COMPLETE,
        context: { prefix: "test-" }
      })
    }));

    // Inner workflow events will be yielded
    const innerStartResult = await workflowRun.next();
    expect(innerStartResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      workflowTitle: 'Inner Workflow',
      newContext: { value: 5 }
    }));

    // Inner workflow step completion
    const innerStepResult = await workflowRun.next();
    expect(innerStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { inner: true, value: 10 },
      completedStep: expect.objectContaining({
        title: 'Double value',
        status: STATUS.COMPLETE,
        context: { inner: true, value: 10 }
      })
    }));

    // Inner workflow completion
    const innerCompleteResult = await workflowRun.next();
    expect(innerCompleteResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      workflowTitle: 'Inner Workflow',
      newContext: { inner: true, value: 10 }
    }));

    // Outer workflow step completion (nested workflow step)
    const nestedStepResult = await workflowRun.next();
    expect(nestedStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { prefix: "test-", innerResult: 10 },
      completedStep: expect.objectContaining({
        title: 'Run inner workflow',
        status: STATUS.COMPLETE,
        context: { prefix: "test-", innerResult: 10 }
      })
    }));

    // Outer workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      workflowTitle: 'Outer Workflow',
      newContext: { prefix: "test-", innerResult: 10 }
    }));
  });

  it('should handle errors in nested workflows', async () => {
    // Create an inner workflow that will throw an error
    const innerWorkflow = createWorkflow('Failing Inner Workflow')
      .step(
        "Throw error",
        () => {
          // Define the shape of the return type before throwing
          if (false) return { value: 0 };
          throw new Error('Inner workflow error');
        }
      );

    // Create outer workflow that uses the failing inner workflow
    const outerWorkflow = createWorkflow('Outer Workflow')
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
        () => ({ value: 5 }),
      );

    const workflowRun = outerWorkflow.run({ initialContext: { step: "" } });

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value!.type).toBe(WORKFLOW_EVENTS.START);

    // First step should complete normally
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { step: "first" }
    }));

    // Inner workflow start
    const innerStartResult = await workflowRun.next();
    expect(innerStartResult.value!.type).toBe(WORKFLOW_EVENTS.START);

    // Inner workflow should error
    const errorResult = await workflowRun.next();
    expect(errorResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.ERROR,
      status: STATUS.ERROR,
      error: expect.objectContaining({
        message: 'Inner workflow error'
      })
    }));

    // Verify the workflow is done
    const doneResult = await workflowRun.next();
    expect(doneResult.done).toBe(true);
  });
});

describe('workflow options', () => {
  it('should pass options through to workflow events', async () => {
    const workflow = createWorkflow<{ testOption: string }>('Options Workflow')
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

    const workflowRun = workflow.run({
      initialContext: { value: 1 },
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
    const workflow = createWorkflow('Default Options Workflow')
      .step(
        "Simple step",
        ({ options }) => ({
          hasOptions: Object.keys(options).length === 0
        })
      );

    const workflowRun = workflow.run({ initialContext: {} });

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

describe('type inference', () => {
  it('should correctly infer complex workflow context types', async () => {
    // Create an inner workflow that uses the shared options type
    const innerWorkflow = createWorkflow<{ features: string[] }>('Inner Type Test')
      .step(
        "Process features",
        ({ options }) => ({
          processedValue: options.features.includes('fast') ? 100 : 42,
          featureCount: options.features.length
        })
      );

    // Create a complex workflow using multiple features
    const complexWorkflow = createWorkflow<{ features: string[] }>('Complex Type Test')
      .step(
        "First step",
        ({ context, options }) => ({
          initialFeatures: options.features,
          value: 42
        })
      )
      .workflow(
        "Nested workflow",
        innerWorkflow,
        ({ context, workflowContext }) => ({
          ...context,
          processedValue: workflowContext.processedValue,
          totalFeatures: workflowContext.featureCount
        }),
      )
      .step(
        "Final step",
        ({ context }) => ({
          ...context,
          completed: true
        })
      );

    // Type test setup
    type ExpectedContext = {
      initialFeatures: string[];
      value: number;
      processedValue: number;
      totalFeatures: number;
      completed: true;
    };

    type ActualContext = Parameters<
      Parameters<(typeof complexWorkflow)['step']>[1]
    >[0]['context'];

    // Type assertion - will fail compilation if types don't match
    type TypeTest = AssertEquals<ActualContext, ExpectedContext>;
    const _typeAssert: TypeTest = true;

    // Run the workflow to verify runtime behavior matches types
    let finalEvent;
    for await (const event of complexWorkflow.run({
      options: { features: ['fast', 'secure'] }
    })) {
      finalEvent = event;
    }

    // Verify the final context has all expected properties with correct types
    expect(finalEvent?.newContext).toEqual({
      initialFeatures: ['fast', 'secure'],
      value: 42,
      processedValue: 100,
      totalFeatures: 2,
      completed: true
    });
  });

  it('should correctly infer workflow reducer context types', async () => {
    // Create an inner workflow with a specific context shape
    const innerWorkflow = createWorkflow('Inner Context Test')
      .step(
        "Inner step",
        () => ({
          innerValue: 42,
          metadata: { processed: true }
        })
      );

    // Create outer workflow to test reducer type inference
    const outerWorkflow = createWorkflow('Outer Context Test')
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
        ({ context, workflowContext }) => {
          // Type assertion for outer context
          type ExpectedOuterContext = {
            outerValue: number;
            status: string;
          };
          type ActualOuterContext = typeof context;
          type OuterContextTest = AssertEquals<
            ActualOuterContext,
            ExpectedOuterContext
          >;
          const _outerAssert: OuterContextTest = true;

          // Type assertion for inner workflow context
          type ExpectedInnerContext = {
            innerValue: number;
            metadata: { processed: true };
          };
          type ActualInnerContext = typeof workflowContext;
          type InnerContextTest = AssertEquals<
            ActualInnerContext,
            ExpectedInnerContext
          >;
          const _innerAssert: InnerContextTest = true;

          return {
            ...context,
            innerResult: workflowContext.innerValue,
            processed: workflowContext.metadata.processed
          };
        }
      );

    // Run the workflow to verify runtime behavior
    let finalEvent;
    for await (const event of outerWorkflow.run()) {
      finalEvent = event;
    }

    expect(finalEvent?.newContext).toEqual({
      outerValue: 100,
      status: 'ready',
      innerResult: 42,
      processed: true
    });
  });

  it('should correctly infer step action context types', async () => {
    const workflow = createWorkflow('Action Context Test')
      .step(
        "First step",
        () => ({
          count: 1,
          metadata: { created: new Date().toISOString() }
        })
      )
      .step(
        "Second step",
        ({ context }) => {
          // Type assertion for action context
          type ExpectedContext = {
            count: number;
            metadata: { created: string };
          };
          type ActualContext = typeof context;
          type ContextTest = AssertEquals<
            ActualContext,
            ExpectedContext
          >;
          const _contextAssert: ContextTest = true;

          return {
            ...context,
            count: context.count + 1,
            metadata: {
              ...context.metadata,
              updated: new Date().toISOString()
            }
          };
        }
      );

    // Run the workflow to verify runtime behavior
    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    expect(finalEvent?.newContext).toMatchObject({
      count: 2,
      metadata: {
        created: expect.any(String),
        updated: expect.any(String)
      }
    });
  });
});

