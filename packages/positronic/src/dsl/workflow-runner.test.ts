import { WorkflowRunner } from './workflow-runner';
import { workflow } from './workflow';
import { WORKFLOW_EVENTS, STATUS } from './constants';
import { ResourceLoader } from '@positronic/resources/src/types';

class TestResourceLoader implements ResourceLoader {
  async load(path: string, type?: 'text' | 'image' | 'binary'): Promise<string | Buffer> {
    return Promise.resolve('');
  }
}

describe('WorkflowRunner', () => {
  const mockClient = {
    execute: jest.fn(),

  };

  const mockShell = {
    execCommand: jest.fn(),
    exec: jest.fn()
  };

  const mockLogger = {
    log: jest.fn()
  };

  const mockAdapter = {
    dispatch: jest.fn()
  };


  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run a workflow and dispatch events to adapters', async () => {
    const runner = new WorkflowRunner({
      adapters: [mockAdapter],
      logger: mockLogger,
      verbose: false,
      client: mockClient,
    });

    const testWorkflow = workflow('Test Workflow')
      .step('First Step', () => ({ value: 42 }))
      .step('Async Step', async ({ state}) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ...state, asyncValue: 'completed' };
      })
      .step('Final Step', ({ state }) => ({
        ...state,
        finalValue: state.value * 2
      }));

    await runner.run(testWorkflow);

    // Verify adapter received all events in correct order
    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.START,
        workflowTitle: 'Test Workflow'
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        stepTitle: 'First Step'
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        stepTitle: 'Async Step'
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        stepTitle: 'Final Step'
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.COMPLETE,
        status: STATUS.COMPLETE
      })
    );

    // Verify the order of events
    const stepCompletions = mockAdapter.dispatch.mock.calls
      .filter(call => call[0].type === WORKFLOW_EVENTS.STEP_COMPLETE)
      .map(call => call[0].stepTitle);

    expect(stepCompletions).toEqual([
      'First Step',
      'Async Step',
      'Final Step'
    ]);
  });

  it('should log final state when verbose is true', async () => {
    const runner = new WorkflowRunner({
      adapters: [],
      logger: mockLogger,
      verbose: true,
      client: mockClient,
    });

    const testWorkflow = workflow('Test Workflow')
      .step('Test Step', () => ({ value: 42 }));

    await runner.run(testWorkflow);

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Workflow completed:')
    );
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('"value": 42')
    );
  });

  it('should handle workflow errors', async () => {
    const runner = new WorkflowRunner({
      adapters: [mockAdapter],
      logger: mockLogger,
      verbose: true,
      client: mockClient,
    });

    const errorWorkflow = workflow('Error Workflow')
      .step('Error Step', () => {
        throw new Error('Test error');
      });

    try {
      await runner.run(errorWorkflow);
    } catch (error) {
      // Expected error
    }

    // Verify error event was dispatched
    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKFLOW_EVENTS.ERROR,
        error: expect.objectContaining({
          message: 'Test error'
        })
      })
    );
  });

  it('should truncate long values in verbose output', async () => {
    const runner = new WorkflowRunner({
      adapters: [],
      logger: mockLogger,
      verbose: true,
      client: mockClient,
    });

    const longString = 'a'.repeat(1000); // Make string much longer
    const testWorkflow = workflow('Test Workflow')
      .step('Test Step', () => ({
        longString,
        nested: { longString }
      }));

    await runner.run(testWorkflow);

    const logCall = mockLogger.log.mock.calls.find(call =>
      call[0].includes('Workflow completed:')
    );

    expect(logCall[0]).toContain('...');
    expect(logCall[0].length).toBeLessThan(longString.length);
  });

  it('should maintain state between steps', async () => {
    const runner = new WorkflowRunner({
      adapters: [],
      logger: mockLogger,
      verbose: true,
      client: mockClient,
    });

    const testWorkflow = workflow('Test Workflow')
      .step('First Step', () => ({ count: 1 }))
      .step('Second Step', ({ state }) => ({
        count: state.count + 1
      }));

    await runner.run(testWorkflow);

    const finalLog = mockLogger.log.mock.calls.find(call =>
      call[0].includes('Workflow completed:')
    );

    expect(finalLog[0]).toContain('"count": 2');
  });
});