import { WORKFLOW_EVENTS } from './constants';
import { applyPatches } from './json-patch';
import type { Adapter } from "../adapters/types";
import type { FileStore } from "../file-stores/types";
import type { SerializedStep, Workflow } from './workflow';
import type { State } from './types';
import type { PromptClient } from '../clients/types';

interface Logger {
  log(...args: any[]): void;
}

export class WorkflowRunner {
  constructor(
    private options: {
      adapters: Adapter[],
      fileStore: FileStore,
      logger: Logger,
      verbose: boolean,
      client: PromptClient
    }
  ) {}

  async run<
    TOptions extends object = {},
    TState extends State = {}
  >(
    workflow: Workflow<TOptions, TState>,
    {
      initialState = {} as TState,
      options,
      initialCompletedSteps,
      workflowRunId
    }: {
      initialState?: TState,
      options?: TOptions,
      initialCompletedSteps?: SerializedStep[] | never,
      workflowRunId?: string | never
    } = {}
  ) {
    const {
      adapters,
      logger: { log },
      verbose,
      fileStore,
      client,
    } = this.options;

    let currentState = initialState ?? ({} as TState);
    let stepNumber = 1;
    let currentStepTitle: string | null = null;

    const workflowRun = workflowRunId && initialCompletedSteps
      ? workflow.run({ initialState, initialCompletedSteps, workflowRunId, options, client, fileStore })
      : workflow.run({ initialState, options, client, fileStore });

    for await (const event of workflowRun) {
      // Dispatch event to all adapters
      await Promise.all(
        adapters.map(adapter => adapter.dispatch(event))
      );

      // Log step starts
      if (event.type === WORKFLOW_EVENTS.STEP_START) {
        currentStepTitle = event.stepTitle;
        process.stdout.write(`\r${stepNumber}. ${currentStepTitle} ...`);
      }

      // Log step completions and increment counter
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        if (currentStepTitle === event.stepTitle) {
          process.stdout.write(`\r${stepNumber}. ${event.stepTitle} ✅\n`);
          stepNumber++;
        }
      }

      // Update current state when steps complete
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE && event.patch) {
        currentState = applyPatches(currentState, [event.patch]) as TState;
      }

      // Log final state on workflow completion/error if verbose
      if ((
        event.type === WORKFLOW_EVENTS.COMPLETE ||
        event.type === WORKFLOW_EVENTS.ERROR
      ) && verbose) {
        log(`\nWorkflow completed: \n\n ${JSON.stringify(
          this.truncateDeep(structuredClone(currentState)), null, 2
        )}`);
      }
    }
  }

  private truncateDeep(obj: any, maxLength: number = 100): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return obj.length > maxLength ? obj.slice(0, maxLength) + '...' : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.truncateDeep(item, maxLength));
    }

    if (typeof obj === 'object') {
      const truncated: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        truncated[key] = this.truncateDeep(value, maxLength);
      }
      return truncated;
    }

    return obj;
  }
}