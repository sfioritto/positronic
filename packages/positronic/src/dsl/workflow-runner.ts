import { WORKFLOW_EVENTS } from './constants';
import { applyPatches } from './json-patch';
import type { Adapter } from "../adapters/types";
import type { FileStore } from "../file-stores/types";
import type { WorkflowEvent, SerializedStep } from './workflow';
import type { State, JsonObject } from './types';

interface Logger {
  log(...args: any[]): void;
}

export class WorkflowRunner {
  constructor(
    private options: {
      adapters: Adapter[],
      fileStore?: FileStore,
      logger: Logger,
      verbose: boolean
    }
  ) {}

  async run<
    TOptions extends JsonObject = {},
    TState extends State = {}
  >(
    workflow: {
      run: (params?: {
        initialState?: TState,
        initialCompletedSteps?: SerializedStep[],
        options?: TOptions
      }) => AsyncGenerator<WorkflowEvent<TOptions>>
    },
    initialState?: TState,
    initialCompletedSteps?: SerializedStep[],
    options?: TOptions
  ) {
    const { adapters, logger: { log }, verbose } = this.options;

    let currentState = initialState ?? ({} as TState);

    for await (const event of workflow.run({
      initialState,
      initialCompletedSteps,
      options
    })) {
      // Dispatch event to all adapters
      await Promise.all(
        adapters.map(adapter => adapter.dispatch(event))
      );

      // Log step completions
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
        log(`${event.stepTitle} ✅`);
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
        log(`Workflow completed: \n\n ${JSON.stringify(
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