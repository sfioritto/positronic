import { BRAIN_EVENTS, STATUS } from './constants.js';
import { createBrainExecutionMachine, sendEvent } from './brain-state-machine.js';
import type { Adapter } from '../adapters/types.js';
import { DEFAULT_ENV, type Brain, type BrainEvent, type ResumeContext } from './brain.js';
import type { State, JsonObject, RuntimeEnv, SignalProvider } from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { Resources } from '../resources/resources.js';
import type { PagesService } from './pages.js';
import type { BrainCancelledEvent } from './definitions/events.js';

/**
 * Create a CANCELLED event for when the brain is aborted via signal.
 * This is synthesized by the runner, not yielded from the brain's event stream.
 */
function createCancelledEvent<TOptions extends JsonObject>(
  brainRunId: string,
  options: TOptions
): BrainCancelledEvent<TOptions> {
  return {
    type: BRAIN_EVENTS.CANCELLED,
    brainRunId,
    brainTitle: '',
    status: STATUS.CANCELLED,
    options,
  };
}

export class BrainRunner {
  constructor(
    private options: {
      adapters: Adapter[];
      client: ObjectGenerator;
      resources?: Resources;
      pages?: PagesService;
      env?: RuntimeEnv;
      signalProvider?: SignalProvider;
    }
  ) {}

  withAdapters(adapters: Adapter[]): BrainRunner {
    const { adapters: existingAdapters } = this.options;
    return new BrainRunner({
      ...this.options,
      adapters: [...existingAdapters, ...adapters],
    });
  }

  withClient(client: ObjectGenerator): BrainRunner {
    return new BrainRunner({
      ...this.options,
      client,
    });
  }

  withResources(resources: Resources): BrainRunner {
    return new BrainRunner({
      ...this.options,
      resources,
    });
  }

  withPages(pages: PagesService): BrainRunner {
    return new BrainRunner({
      ...this.options,
      pages,
    });
  }

  withEnv(env: RuntimeEnv): BrainRunner {
    return new BrainRunner({
      ...this.options,
      env,
    });
  }

  withSignalProvider(signalProvider: SignalProvider): BrainRunner {
    return new BrainRunner({
      ...this.options,
      signalProvider,
    });
  }

  async run<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    {
      initialState = {} as TState,
      options,
      resumeContext,
      brainRunId,
      endAfter,
      signal,
    }: {
      initialState?: TState;
      options?: TOptions;
      resumeContext?: ResumeContext;
      brainRunId?: string;
      endAfter?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<TState> {
    const { adapters, client, resources, pages, env, signalProvider } = this.options;
    const resolvedEnv = env ?? DEFAULT_ENV;

    // Determine initial state for the state machine
    // If resuming, use the state from resumeContext; otherwise use initialState
    const machineInitialState: JsonObject = resumeContext?.state ?? initialState ?? {};
    const initialStepCount = resumeContext?.stepIndex ?? 0;

    // Create state machine with pre-populated state for runtime tracking.
    const machine = createBrainExecutionMachine({
      initialState: machineInitialState,
    });

    const brainRun = resumeContext
      ? brain.run({
          resumeContext,
          brainRunId: brainRunId!,
          options,
          client,
          resources: resources ?? {},
          pages,
          env: resolvedEnv,
          signalProvider,
        })
      : brain.run({
          initialState,
          options,
          client,
          brainRunId,
          resources: resources ?? {},
          pages,
          env: resolvedEnv,
          signalProvider,
        });

    try {
      for await (const event of brainRun) {
        // Check if we've been cancelled
        if (signal?.aborted) {
          const cancelledEvent = createCancelledEvent(
            machine.context.brainRunId ?? '',
            (options ?? {}) as TOptions
          );
          await Promise.all(adapters.map((adapter) => adapter.dispatch(cancelledEvent)));
          // Cast is safe: state started as TState and patches maintain the structure
          return machine.context.currentState as TState;
        }

        // Feed event to state machine - this updates currentState, isTopLevel, stepCount, etc.
        sendEvent(machine, event);

        // Dispatch event to all adapters
        await Promise.all(adapters.map((adapter) => adapter.dispatch(event)));

        // Check if we should stop after this step (only for top-level steps)
        // The machine's topLevelStepCount tracks steps since this run started,
        // so we add initialStepCount to get the total step count.
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE && machine.context.isTopLevel) {
          const totalSteps = machine.context.topLevelStepCount + initialStepCount;
          if (endAfter && totalSteps >= endAfter) {
            // Cast is safe: state started as TState and patches maintain the structure
            return machine.context.currentState as TState;
          }
        }

        // Stop execution when machine enters paused or waiting state
        if (machine.context.isPaused || machine.context.isWaiting) {
          // Cast is safe: state started as TState and patches maintain the structure
          return machine.context.currentState as TState;
        }
      }
    } catch (error) {
      // If aborted while awaiting, check signal and emit cancelled event
      if (signal?.aborted) {
        const cancelledEvent = createCancelledEvent(
          machine.context.brainRunId ?? '',
          (options ?? {}) as TOptions
        );
        await Promise.all(adapters.map((adapter) => adapter.dispatch(cancelledEvent)));
        // Cast is safe: state started as TState and patches maintain the structure
        return machine.context.currentState as TState;
      }
      throw error;
    }

    // Cast is safe: state started as TState and patches maintain the structure
    return machine.context.currentState as TState;
  }
}
