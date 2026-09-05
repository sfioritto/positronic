import { BRAIN_EVENTS, STATUS } from './constants.js';
import {
  createBrainExecutionMachine,
  sendEvent,
  type BrainStateMachine,
} from './brain-state-machine.js';
import type { Adapter } from '../adapters/types.js';
import { DEFAULT_ENV, type Brain } from './brain.js';
import type {
  State,
  JsonObject,
  RuntimeEnv,
  SignalProvider,
  CurrentUser,
} from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { Resources } from '../resources/resources.js';
import type {
  BrainEvent,
  BrainCancelledEvent,
  BrainErrorEvent,
} from './definitions/events.js';
import type { ResumeParams } from './definitions/run-params.js';
import type { Files } from '../files/types.js';
import type { Pages } from './pages.js';
import type { StoreProvider } from '../store/types.js';

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

/**
 * Create an ERROR event for when execution fails outside the brain's event
 * stream (an adapter's dispatch rejecting, a reducer throwing). This is
 * synthesized by the runner, not yielded from the brain's event stream.
 */
function createErrorEvent<TOptions extends JsonObject>(
  brainTitle: string,
  brainRunId: string,
  options: TOptions,
  error: unknown
): BrainErrorEvent<TOptions> {
  const serializedError =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Error', message: String(error) };

  return {
    type: BRAIN_EVENTS.ERROR,
    status: STATUS.ERROR,
    brainTitle,
    brainRunId,
    options,
    error: serializedError,
  };
}

type BrainRunnerConfig = {
  client: ObjectGenerator;
  adapters: Adapter[];
  env?: RuntimeEnv;
  resources?: Resources;
  signalProvider?: SignalProvider;
  governor?: (client: ObjectGenerator) => ObjectGenerator;
  files?: Files;
  pages?: Pages;
  storeProvider?: StoreProvider;
};

export class BrainRunner {
  constructor(private config: BrainRunnerConfig) {}

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
    TState extends State = {},
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
        });

    const dispatch = (event: BrainEvent<TOptions>) =>
      Promise.all(adapters.map((adapter) => adapter.dispatch(event)));
    const runOptions = (options ?? {}) as TOptions;

    // The machine's view as of the last event every adapter received. Events
    // are fed to the machine before they are dispatched, so when a dispatch
    // throws the machine is one event ahead of every consumer. Anything
    // synthesized on failure has to reason from what consumers actually saw.
    let delivered = { isError: false, brainIdStack: [] as string[] };

    try {
      for await (const event of brainRun) {
        // Check if we've been cancelled
        if (signal?.aborted) {
          await dispatch(
            createCancelledEvent(machine.context.brainRunId ?? '', runOptions)
          );
          // Cast is safe: state started as TState and patches maintain the structure
          return machine.context.currentState as TState;
        }

        // Feed event to state machine - this updates currentState, isTopLevel, stepCount, etc.
        sendEvent(machine, event);

        await dispatch(event);
        const { isError, brainIdStack } = machine.context;
        delivered = { isError, brainIdStack };

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
        await dispatch(
          createCancelledEvent(machine.context.brainRunId ?? '', runOptions)
        );
        // Cast is safe: state started as TState and patches maintain the structure
        return machine.context.currentState as TState;
      }
      if (!delivered.isError) {
        // No consumer has seen a terminal ERROR. Either the failure happened
        // outside the event stream (an adapter's dispatch, a reducer) so the
        // generator never emitted one, or the generator did emit one and its
        // dispatch is what threw. Write one for every brain consumers still
        // have open, innermost first, the way the stream's own catch blocks
        // do when brain code throws, so a consumer replaying these events
        // lands the outer brain in error instead of "running". Adapters that
        // accepted the failing event see a second ERROR; the terminal state
        // ignores it. Nothing was delivered if START itself failed, and
        // there is nothing to end in that case.
        const runId = machine.context.brainRunId ?? '';
        for (const title of [...delivered.brainIdStack].reverse()) {
          await dispatch(createErrorEvent(title, runId, runOptions, error));
        }
      }
      // Resolving here keeps error in line with cancel and completion: the
      // event stream is the one place that says how a run ended.
      // Cast is safe: state started as TState and patches maintain the structure
      return machine.context.currentState as TState;
    }

    // Cast is safe: state started as TState and patches maintain the structure
    return machine.context.currentState as TState;
  }
}
