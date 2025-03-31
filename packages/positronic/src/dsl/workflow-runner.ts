import { WORKFLOW_EVENTS } from './constants';
import { applyPatches } from './json-patch';
import type { Adapter } from "../adapters/types";
import type { SerializedStep, Workflow } from './workflow';
import type { State } from './types';
import type { PromptClient } from '../clients/types';
import type { Shell } from '../shells/types';

interface Logger {
  log(...args: any[]): void;
}

export class WorkflowRunner {
  constructor(
    private options: {
      adapters: Adapter[],
      shell: Shell,
      logger: Logger,
      verbose: boolean,
      client: PromptClient,
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
      workflowRunId,
      endAfter
    }: {
      initialState?: TState,
      options?: TOptions,
      initialCompletedSteps?: SerializedStep[] | never,
      workflowRunId?: string | never,
      endAfter?: number
    } = {}
  ) {
    const {
      adapters,
      logger: { log },
      verbose,
      client,
      shell,
    } = this.options;

    let currentState = initialState ?? ({} as TState);
    let stepNumber = 1;

    // Apply any patches from completed steps
    // to the initial state so that the workflow
    // starts with a state that reflects all of the completed steps.
    // Need to do this when a workflow is restarted with completed steps.
    initialCompletedSteps?.forEach(step => {
      if (step.patch) {
        currentState = applyPatches(currentState, [step.patch]) as TState;
        stepNumber++;
      }
    });

    const workflowRun = workflowRunId && initialCompletedSteps
      ? workflow.run({ initialState, initialCompletedSteps, workflowRunId, options, client, shell })
      : workflow.run({ initialState, options, client, shell });

    for await (const event of workflowRun) {
      // Dispatch event to all adapters
      await Promise.all(
        adapters.map(adapter => adapter.dispatch(event))
      );

      // Update current state when steps complete
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        if (event.patch) {
          currentState = applyPatches(currentState, [event.patch]) as TState;
        }

        // Check if we should stop after this step
        if (endAfter && stepNumber >= endAfter) {
          // Log final state if verbose
          if (verbose) {
            log(`\nWorkflow stopped after step ${endAfter} as requested: \n\n ${JSON.stringify(
              this.truncateDeep(structuredClone(currentState)), null, 2
            )}`);
          }
          return;
        }

        stepNumber++;
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
      if (obj.length === 0) return obj;

      let truncatedArray = [];
      let currentLength = 2; // Account for [] brackets

      for (let i = 0; i < obj.length; i++) {
        const processedItem = this.truncateDeep(obj[i], maxLength);
        const itemStr = JSON.stringify(processedItem);

        if (currentLength + itemStr.length + (i > 0 ? 1 : 0) > maxLength) {
          truncatedArray.push(`... (${obj.length})`);
          break;
        }

        truncatedArray.push(processedItem);
        currentLength += itemStr.length + (i > 0 ? 1 : 0); // Add 1 for comma
      }

      return truncatedArray;
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