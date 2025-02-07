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
