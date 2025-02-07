import { WORKFLOW_EVENTS } from './dsl/constants';
import type { Adapter } from "./adapters/adapter";
import type { FileStore } from "./file-stores";
import type { Event } from './dsl/blocks';
import type { State, JsonObject } from './dsl/types';

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
        initialCompletedSteps?: Array<{
          title: string,
          status: string,
          state: JsonObject
        }>,
        options?: TOptions
      }) => AsyncGenerator<Event<TState, TState, TOptions>>
    },
    initialState?: TState,
    initialCompletedSteps?: Array<{
      title: string,
      status: string,
      state: JsonObject
    }>,
    options?: TOptions
  ) {
    const { adapters, logger: { log }, verbose } = this.options;

    for await (const event of workflow.run({
      initialState,
      initialCompletedSteps,
      options
    })) {
      // Dispatch event to all adapters
      await Promise.all(
        adapters.map(adapter => adapter.dispatch(event))
      );

      // Log completed steps
      if (event.completedStep) {
        log(`${event.completedStep.title} ✅`);
      }

      // Log final state on workflow completion/error if verbose
      if ((
        event.type === WORKFLOW_EVENTS.COMPLETE ||
        event.type === WORKFLOW_EVENTS.ERROR
      ) && verbose) {
        log(`Workflow completed: \n\n ${JSON.stringify(
          this.truncateDeep(structuredClone(event.newState)), null, 2
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