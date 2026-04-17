import { BRAIN_EVENTS, STATUS } from './constants.js';
import {
  createBrainExecutionMachine,
  sendEvent,
  type BrainStateMachine,
} from './brain-state-machine.js';
import type { Adapter } from '../adapters/types.js';
import { DEFAULT_ENV, type Brain, type BrainEvent } from './brain.js';
import type {
  State,
  JsonObject,
  RuntimeEnv,
  SignalProvider,
  CurrentUser,
} from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { Resources } from '../resources/resources.js';
import type { BrainCancelledEvent } from './definitions/events.js';
import type { ResumeParams } from './definitions/run-params.js';
import type { Files } from '../files/types.js';
import type { Pages } from './pages.js';
import type { StoreProvider } from '../store/types.js';
import type { ConfiguredPlugin } from '../plugins/types.js';

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
    private config: {
      client: ObjectGenerator;
      adapters: Adapter[];
      env?: RuntimeEnv;
      resources?: Resources;
      signalProvider?: SignalProvider;
      governor?: (client: ObjectGenerator) => ObjectGenerator;
      files?: Files;
      pages?: Pages;
      storeProvider?: StoreProvider;
      pluginConfigs?: ConfiguredPlugin[];
    }
  ) {}

  get client(): ObjectGenerator {
    return this.config.client;
  }

  /**
   * Run a brain from the beginning with fresh state.
   */
  async run<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    options: {
      currentUser: CurrentUser;
      initialState?: TState;
      options?: TOptions;
      brainRunId?: string;
      endAfter?: number;
      signal?: AbortSignal;
    }
  ): Promise<TState> {
    const {
      initialState = {} as TState,
      options: brainOptions,
      brainRunId,
      endAfter,
      signal,
      currentUser,
    } = options;

    return this.execute(brain, {
      initialState,
      options: brainOptions,
      brainRunId,
      endAfter,
      signal,
      currentUser,
      initialStepCount: 0,
    });
  }

  /**
   * Resume a brain from a previous execution point.
   * The machine should have historical events already replayed to reconstruct execution state.
   * The BrainRunner builds a ResumeParams from the machine's execution stack.
   * Webhook response data comes from signals, not as a parameter.
   */
  async resume<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    options: {
      currentUser: CurrentUser;
      machine: BrainStateMachine;
      brainRunId: string;
      options?: TOptions;
      endAfter?: number;
      signal?: AbortSignal;
    }
  ): Promise<TState> {
    const {
      machine,
      brainRunId,
      options: brainOptions,
      endAfter,
      signal,
      currentUser,
    } = options;

    const { executionStack, iterateContext, currentPage, promptLoopContext } =
      machine.context;

    if (executionStack.length === 0) {
      throw new Error('Cannot resume from empty execution stack');
    }

    const topEntry = executionStack[0];
    const innerStack =
      executionStack.length > 1 ? executionStack.slice(1) : undefined;

    return this.execute(brain, {
      resume: {
        state: topEntry.state,
        stepIndex: topEntry.stepIndex,
        innerStack,
        iterateProgress: iterateContext ?? undefined,
        currentPage: currentPage ?? undefined,
        promptLoopContext: promptLoopContext ?? undefined,
      },
      machine,
      options: brainOptions,
      brainRunId,
      endAfter,
      signal,
      currentUser,
      initialStepCount: topEntry.stepIndex,
    });
  }

  /**
   * Internal execution method shared by run() and resume().
   */
  private async execute<
    TOptions extends JsonObject = {},
    TState extends State = {}
  >(
    brain: Brain<TOptions, TState, any>,
    params: {
      initialState?: TState;
      resume?: ResumeParams;
      machine?: BrainStateMachine;
      options?: TOptions;
      brainRunId?: string;
      endAfter?: number;
      signal?: AbortSignal;
      currentUser: CurrentUser;
      initialStepCount: number;
    }
  ): Promise<TState> {
    const {
      client: rawClient,
      adapters,
      env,
      resources,
      signalProvider,
      governor,
      files,
      pages,
      storeProvider,
      pluginConfigs,
    } = this.config;
    const client = governor ? governor(rawClient) : rawClient;
    const resolvedEnv = env ?? DEFAULT_ENV;
    const {
      initialState,
      resume,
      machine: providedMachine,
      options,
      brainRunId,
      endAfter,
      signal,
      currentUser,
      initialStepCount,
    } = params;

    // Use provided state machine if available (for resumes with historical events),
    // otherwise create a new one
    const machine =
      providedMachine ??
      createBrainExecutionMachine({
        initialState: resume?.state ?? initialState ?? {},
      });

    const brainRun = resume
      ? brain.run({
          resume,
          brainRunId: brainRunId!,
          options,
          client,
          resources: resources ?? {},
          env: resolvedEnv,
          signalProvider,
          governor,
          currentUser,
          files,
          pages,
          storeProvider,
          pluginConfigs,
        })
      : brain.run({
          initialState: initialState ?? ({} as TState),
          options,
          client,
          brainRunId,
          resources: resources ?? {},
          env: resolvedEnv,
          signalProvider,
          governor,
          currentUser,
          files,
          pages,
          storeProvider,
          pluginConfigs,
        });

    try {
      for await (const event of brainRun) {
        // Check if we've been cancelled
        if (signal?.aborted) {
          const cancelledEvent = createCancelledEvent(
            machine.context.brainRunId ?? '',
            (options ?? {}) as TOptions
          );
          await Promise.all(
            adapters.map((adapter) => adapter.dispatch(cancelledEvent))
          );
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
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          machine.context.isTopLevel
        ) {
          const totalSteps =
            machine.context.topLevelStepCount + initialStepCount;
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
        await Promise.all(
          adapters.map((adapter) => adapter.dispatch(cancelledEvent))
        );
        // Cast is safe: state started as TState and patches maintain the structure
        return machine.context.currentState as TState;
      }
      throw error;
    }

    // Cast is safe: state started as TState and patches maintain the structure
    return machine.context.currentState as TState;
  }
}
