import { createWorkflow, Event } from './dsl/new-dsl';
import { WORKFLOW_EVENTS, STATUS } from './dsl/constants';
import { JsonObject } from './dsl/types';

describe('workflow creation', () => {
  it('should create a workflow with steps and run through them', async () => {
    const workflow = createWorkflow('test workflow')
      .step(
        "First step",
        () => ({ count: 1 })
      )
      .step(
        "Second step",
        ({ context }) => ({ doubled: context.count * 2 })
      );

    const workflowRun = workflow.run({});

    // Check start event
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      newContext: {}
    }));

    // Check first step completion
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { count: 1 },
      completedStep: expect.objectContaining({
        title: 'First step',
        status: STATUS.COMPLETE
      })
    }));

    // Check second step completion
    const secondStepResult = await workflowRun.next();
    expect(secondStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: { count: 1, doubled: 2 },
      completedStep: expect.objectContaining({
        title: 'Second step',
        status: STATUS.COMPLETE
      })
    }));

    // Check workflow completion
    const completeResult = await workflowRun.next();
    expect(completeResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      newContext: { count: 1, doubled: 2 }
    }));
  });

  it('should create a workflow with a name and description when passed an object', async () => {
    const workflow = createWorkflow({
      name: 'my named workflow',
      description: 'some description'
    });

    const workflowRun = workflow.run({});
    const startResult = await workflowRun.next();
    expect(startResult.value).toEqual(expect.objectContaining({
      workflowName: 'my named workflow',
      description: 'some description',
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
      workflowName: 'simple workflow',
      type: WORKFLOW_EVENTS.START
    }));
    expect(event.workflowDescription).toBeUndefined();
  });
});

describe('error handling', () => {
  it('should handle errors in steps and maintain correct status/context', async () => {
    const workflow = createWorkflow('Error Workflow')
      .step(
        "First step",
        () => ({ value: 1 })
      )
      .step(
        "Error step",
        (): void => {
          throw new Error('Test error');
        }
      )
      .step(
        "Never reached",
        ({ context }) => ({ value: context.value + 1 })
      );

    const workflowRun = workflow.run({});

    // Skip START event
    await workflowRun.next();

    // First step should complete normally
    const firstStepResult = await workflowRun.next();
    expect(firstStepResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: { value: 1 },
      completedStep: expect.objectContaining({
        title: 'First step',
        status: STATUS.COMPLETE
      })
    }));

    // Error step should fail
    const errorResult = await workflowRun.next();
    expect(errorResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.ERROR,
      status: STATUS.ERROR,
      error: new Error('Test error'),
      completedStep: expect.objectContaining({
        title: 'Error step',
        status: STATUS.ERROR
      }),
      // Verify step statuses in error state
      steps: [
        expect.objectContaining({ status: STATUS.COMPLETE }),
        expect.objectContaining({ status: STATUS.ERROR }),
        expect.objectContaining({ status: STATUS.PENDING })
      ]
    }));

    // Verify workflow stops after error
    const noMoreResults = await workflowRun.next();
    expect(noMoreResults.done).toBe(true);
  });
});

describe('step immutability', () => {
  it('should maintain immutable steps across workflow events', async () => {
    const workflow = createWorkflow('Immutable Steps Workflow')
      .step(
        "Step 1",
        () => ({ value: 1 })
      )
      .step(
        "Step 2",
        ({ context }) => ({ value: context.value * 2 })
      );

    const workflowRun = workflow.run({});

    // Get past the START event
    await workflowRun.next();

    // After first step completes, try to modify its data
    const firstStepResult = await workflowRun.next();
    const steps = firstStepResult.value?.steps;

    if (!steps) {
      throw new Error('Steps not found');
    }

    // Try to modify the first step's status and context
    steps[0].status = STATUS.PENDING;
    steps[0].context = { value: 999 };

    // Get the second step result
    const secondStepResult = await workflowRun.next();

    // Verify modifications didn't persist
    expect(secondStepResult.value).toEqual(expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({
          title: 'Step 1',
          status: STATUS.COMPLETE,
          context: { value: 1 }
        })
      ])
    }));

    // Verify second step executed correctly
    expect(secondStepResult.value).toEqual(expect.objectContaining({
      newContext: { value: 2 },
      completedStep: expect.objectContaining({
        title: 'Step 2',
        status: STATUS.COMPLETE
      })
    }));
  });
});

describe('workflow event sequence', () => {
  it('should emit events in correct order with proper context/status', async () => {
    const workflow = createWorkflow('Simple Workflow')
      .step(
        "Increment step",
        () => ({ value: 1 })
      )
      .step(
        "Double step",
        ({ context }) => ({ value: context.value * 2 })
      );

    const events: Event<any, any, any>[] = [];
    const workflowRun = workflow.run({});

    // Collect all events
    for await (const event of workflowRun) {
      events.push(event);
    }

    // Verify event sequence and key properties
    expect(events).toHaveLength(4);

    // START event
    expect(events[0]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      newContext: {}
    }));

    // First UPDATE event (after increment)
    expect(events[1]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: { value: 1 },
      completedStep: expect.objectContaining({
        title: 'Increment step',
        status: STATUS.COMPLETE
      })
    }));

    // Second UPDATE event (after double)
    expect(events[2]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: { value: 2 },
      completedStep: expect.objectContaining({
        title: 'Double step',
        status: STATUS.COMPLETE
      })
    }));

    // COMPLETE event
    expect(events[3]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      newContext: { value: 2 }
    }));
  });
});

describe('step completion', () => {
  it('should track step completion independently with correct context transformations', async () => {
    interface SimpleContext extends JsonObject {
      value: number;
      [key: string]: any;
    }

    const workflow = createWorkflow<{}, SimpleContext>('Two Step Workflow')
      .step(
        "Double step",
        ({ context }) => ({ value: context.value * 2 })
      )
      .step(
        "Add one step",
        ({ context }) => ({ value: context.value + 1 })
      );

    const stepCompletions: Array<{
      title: string;
      context: SimpleContext;
    }> = [];

    const workflowRun = workflow.run({ initialContext: { value: 1 } });

    // Skip START event
    await workflowRun.next();

    // Collect step completions from UPDATE events
    let result = await workflowRun.next();
    while (!result.done && result.value.type === WORKFLOW_EVENTS.UPDATE) {
      stepCompletions.push({
        title: result.value.completedStep!.title,
        context: result.value.completedStep!.context as SimpleContext
      });
      result = await workflowRun.next();
    }

    // Verify final state
    expect(result.value).toEqual(expect.objectContaining({
      workflowName: 'Two Step Workflow',
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      previousContext: { value: 1 },
      newContext: { value: 3 },
      steps: [
        { title: 'Double step', status: STATUS.COMPLETE, context: { value: 2 } },
        { title: 'Add one step', status: STATUS.COMPLETE, context: { value: 3 } }
      ],
      options: {}
    }));

    // Verify step completions happened in correct order with correct contexts
    expect(stepCompletions).toEqual([
      {
        title: 'Double step',
        context: { value: 2 }
      },
      {
        title: 'Add one step',
        context: { value: 3 }
      }
    ]);
  });
});

describe('workflow options', () => {
  it('should pass options through to steps and maintain them in events', async () => {
    interface WorkflowOptions extends JsonObject {
      testOption: string;
      [key: string]: any;
    }

    const workflow = createWorkflow<WorkflowOptions>('Options Workflow')
      .step(
        "First step",
        () => ({ value: 1 }),
        ({ result, options }) => ({
          value: result.value,
          usedOption: options.testOption
        })
      )
      .step(
        "Second step",
        ({ context }) => ({ value: context.value * 2 }),
        ({ result, options }) => ({
          value: result.value,
          usedOption: options.testOption
        })
      );

    const workflowOptions = {
      testOption: 'test-value'
    };

    const events: Event<any, any, any>[] = [];
    const workflowRun = workflow.run({
      options: workflowOptions
    });

    // Collect all events
    for await (const event of workflowRun) {
      events.push(event);
    }

    // Verify START event has options and empty context
    expect(events[0]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.START,
      options: workflowOptions,
      newContext: {}
    }));

    // Verify first step used options correctly
    expect(events[1]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: {
        value: 1,
        usedOption: 'test-value'
      },
      completedStep: expect.objectContaining({
        title: 'First step',
        status: STATUS.COMPLETE
      })
    }));

    // Verify second step maintained options
    expect(events[2]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      newContext: {
        value: 2,
        usedOption: 'test-value'
      },
      completedStep: expect.objectContaining({
        title: 'Second step',
        status: STATUS.COMPLETE
      })
    }));

    // Verify final state
    expect(events[3]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.COMPLETE,
      newContext: {
        value: 2,
        usedOption: 'test-value'
      }
    }));
  });
});

describe('context immutability', () => {
  it('should not modify the original context when action or reducer mutates context', async () => {
    const originalContext = {
      value: 1,
      nested: { count: 0 }
    } as const;

    type TestContext = {
      value: number;
      nested: { count: number };
    }

    const workflow = createWorkflow<{}, TestContext>('Mutation Test Workflow')
      .step(
        "Mutating action step",
        ({ context }) => {
          // Try to mutate context directly
          (context as any).value = 99;
          (context as any).nested.count = 99;
          return { value: 99, nested: { count: 99 } };
        }
      )
      .step(
        "Mutating reducer step",
        () => 42,
        ({ context }) => {
          // Try to mutate context directly
          (context as any).value = 100;
          (context as any).nested.count = 100;
          return { value: 100, nested: { count: 100 } };
        }
      );

    const workflowRun = workflow.run({
      initialContext: originalContext
    });

    // Run through all events
    const events: Event<any, any, any>[] = [];
    for await (const event of workflowRun) {
      events.push(event);
    }

    // Verify original context remains unchanged
    expect(originalContext).toEqual({
      value: 1,
      nested: { count: 0 }
    });

    // Verify that the workflow still progressed with the new values
    expect(events[events.length - 1].newContext).toEqual({
      value: 100,
      nested: { count: 100 }
    });
  });
});

describe('workflow resumption', () => {
  it('should resume workflow from a specific step with correct context chain', async () => {
    const workflow = createWorkflow('Three Step Workflow')
      .step(
        "Step 1: Double",
        () => ({ value: 2 })  // First step establishes the context shape
      )
      .step(
        "Step 2: Add 10",
        ({ context }) => ({ value: context.value + 10 })  // Now we know context has value
      )
      .step(
        "Step 3: Multiply by 3",
        ({ context }) => ({ value: context.value * 3 })
      );

    // First run the workflow normally to get completed steps
    const events: Event<any, any, any>[] = [];
    const fullRun = workflow.run({});  // No initial context needed
    for await (const event of fullRun) {
      events.push(event);
    }

    // Get the completed first step
    const firstStep = events[1].completedStep!;

    // Now run the workflow again, but starting from step 2
    const resumedEvents: Event<any, any, any>[] = [];
    const resumedRun = workflow.run({
      initialCompletedSteps: [firstStep]
    });

    for await (const event of resumedRun) {
      resumedEvents.push(event);
    }

    // Verify the full run executed correctly
    expect(events[events.length - 1].newContext).toEqual({
      value: 36  // (2 + 10) * 3 = 36
    });
    expect(events.map(e => e.type)).toEqual([
      WORKFLOW_EVENTS.START,
      WORKFLOW_EVENTS.UPDATE,  // After double
      WORKFLOW_EVENTS.UPDATE,  // After add 10
      WORKFLOW_EVENTS.UPDATE,  // After multiply by 3
      WORKFLOW_EVENTS.COMPLETE
    ]);
    expect(events[1].completedStep?.context.value).toBe(2);   // After double
    expect(events[2].completedStep?.context.value).toBe(12);  // After add 10
    expect(events[3].completedStep?.context.value).toBe(36);  // After multiply by 3

    // Verify the resumed run started from step 2
    expect(resumedEvents[0].type).toBe(WORKFLOW_EVENTS.RESTART);
    expect(resumedEvents[0].steps).toEqual([
      { title: 'Step 1: Double', status: STATUS.COMPLETE, context: { value: 2 } },
      { title: 'Step 2: Add 10', status: STATUS.PENDING, context: { value: 2 } },
      { title: 'Step 3: Multiply by 3', status: STATUS.PENDING, context: { value: 2 } }
    ]);

    // Verify resumed run completed correctly
    expect(resumedEvents[resumedEvents.length - 1].newContext).toEqual({
      value: 36  // Same final result
    });
    expect(resumedEvents.map(e => e.type)).toEqual([
      WORKFLOW_EVENTS.RESTART,
      WORKFLOW_EVENTS.UPDATE,   // After add 10
      WORKFLOW_EVENTS.UPDATE,   // After multiply by 3
      WORKFLOW_EVENTS.COMPLETE
    ]);
  });
});

describe('file extension', () => {
  it('should add files to context', async () => {
    const workflow = createWorkflow('File Workflow')
      .file('config', 'config.json')
      .step(
        "Process config",
        ({ context }: { context: { files: Record<string, string> } }) => {
          expect(context.files.config).toBe("File content will go here.");
          return { processed: true };
        }
      );

    const events: Event<any, any, any>[] = [];
    const workflowRun = workflow.run({});

    // Collect all events
    for await (const event of workflowRun) {
      events.push(event);
    }

    // Verify file was added to context
    expect(events[1]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: expect.objectContaining({
        files: {
          config: "File content will go here."
        }
      })
    }));

    // Verify subsequent step worked with file context
    expect(events[2]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: expect.objectContaining({
        files: {
          config: "File content will go here."
        },
        processed: true
      })
    }));
  });

  it('should prevent duplicate file names', async () => {
    const workflow = createWorkflow('Duplicate Files Workflow')
      .file('config', 'config1.json')
      .file('config', 'config2.json');

    const workflowRun = workflow.run({});

    // Skip START event
    await workflowRun.next();

    // First file should succeed
    const firstFileResult = await workflowRun.next();
    expect(firstFileResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: expect.objectContaining({
        files: {
          config: "File content will go here."
        }
      })
    }));

    // Second file should fail
    const secondFileResult = await workflowRun.next();
    expect(secondFileResult.value).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.ERROR,
      status: STATUS.ERROR,
      error: expect.objectContaining({
        message: 'File name "config" already exists in this workflow run. Names must be unique within a workflow.'
      })
    }));
  });

  it('should accumulate multiple files', async () => {
    const workflow = createWorkflow('Multiple Files Workflow')
      .file('config1', 'config1.json')
      .file('config2', 'config2.json')
      .step(
        "Process configs",
        ({ context }: { context: { files: Record<string, string> } }) => {
          expect(context.files.config1).toBe("File content will go here.");
          expect(context.files.config2).toBe("File content will go here.");
          return { processed: true };
        }
      );

    const events: Event<any, any, any>[] = [];
    const workflowRun = workflow.run({});

    // Collect all events
    for await (const event of workflowRun) {
      events.push(event);
    }

    // Verify both files were added
    expect(events[2]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: expect.objectContaining({
        files: {
          config1: "File content will go here.",
          config2: "File content will go here."
        }
      })
    }));

    // Verify final context has both files and processed flag
    expect(events[3]).toEqual(expect.objectContaining({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      newContext: expect.objectContaining({
        files: {
          config1: "File content will go here.",
          config2: "File content will go here."
        },
        processed: true
      })
    }));
  });
});