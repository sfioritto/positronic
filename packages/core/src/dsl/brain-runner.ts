import { BRAIN_EVENTS, STATUS } from './constants.js';
import { createBrainExecutionMachine, sendEvent, type BrainStateMachine } from './brain-state-machine.js';
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

  /**
   * Run a brain from the beginning with fresh state.
   */
  async run<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    options?: {
      initialState?: TState;
      options?: TOptions;
      brainRunId?: string;
      endAfter?: number;
      signal?: AbortSignal;
    }
  ): Promise<TState> {
    const { initialState = {} as TState, options: brainOptions, brainRunId, endAfter, signal } = options ?? {};

    return this.execute(brain, {
      initialState,
      options: brainOptions,
      brainRunId,
      endAfter,
      signal,
      initialStepCount: 0,
    });
  }

  /**
   * Resume a brain from a previous execution point.
   * If a state machine is provided, it will be used instead of creating a new one.
   * This allows the caller to pass a machine that already has historical events replayed.
   */
  async resume<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    options: {
      resumeContext: ResumeContext;
      brainRunId: string;
      machine?: BrainStateMachine;
      options?: TOptions;
      endAfter?: number;
      signal?: AbortSignal;
    }
  ): Promise<TState> {
    const { resumeContext, brainRunId, machine, options: brainOptions, endAfter, signal } = options;

    return this.execute(brain, {
      resumeContext,
      machine,
      options: brainOptions,
      brainRunId,
      endAfter,
      signal,
      initialStepCount: resumeContext.stepIndex,
    });
  }

  /**
   * Internal execution method shared by run() and resume().
   */
  private async execute<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    params: {
      initialState?: TState;
      resumeContext?: ResumeContext;
      machine?: BrainStateMachine;
      options?: TOptions;
      brainRunId?: string;
      endAfter?: number;
      signal?: AbortSignal;
      initialStepCount: number;
    }
  ): Promise<TState> {
    const { adapters, client, resources, pages, env, signalProvider } = this.options;
    const resolvedEnv = env ?? DEFAULT_ENV;
    const { initialState, resumeContext, machine: providedMachine, options, brainRunId, endAfter, signal, initialStepCount } = params;

    // Use provided state machine if available (for resumes with historical events),
    // otherwise create a new one
    const machine = providedMachine ?? createBrainExecutionMachine({
      initialState: resumeContext?.state ?? initialState ?? {},
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
          initialState: initialState ?? ({} as TState),
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
