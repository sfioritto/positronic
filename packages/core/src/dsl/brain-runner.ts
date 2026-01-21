import { BRAIN_EVENTS } from './constants.js';
import { applyPatches } from './json-patch.js';
import { reconstructLoopContext } from './loop-messages.js';
import { createBrainExecutionMachine, sendEvent } from './brain-state-machine.js';
import type { Adapter } from '../adapters/types.js';
import { DEFAULT_ENV, type SerializedStep, type Brain, type BrainEvent } from './brain.js';
import type { State, JsonObject, RuntimeEnv } from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { Resources } from '../resources/resources.js';
import type { PagesService } from './pages.js';

export class BrainRunner {
  constructor(
    private options: {
      adapters: Adapter[];
      client: ObjectGenerator;
      resources?: Resources;
      pages?: PagesService;
      env?: RuntimeEnv;
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

  async run<TOptions extends JsonObject = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    {
      initialState = {} as TState,
      options,
      initialCompletedSteps,
      brainRunId,
      endAfter,
      signal,
      response,
      loopEvents,
    }: {
      initialState?: TState;
      options?: TOptions;
      initialCompletedSteps?: SerializedStep[] | never;
      brainRunId?: string | never;
      endAfter?: number;
      signal?: AbortSignal;
      response?: JsonObject;
      loopEvents?: BrainEvent[];
    } = {}
  ): Promise<TState> {
    const { adapters, client, resources, pages, env } = this.options;
    const resolvedEnv = env ?? DEFAULT_ENV;

    // Apply any patches from completed steps to get the initial state
    // for the state machine. The machine will then track all subsequent state changes.
    let machineInitialState: JsonObject = initialState ?? {};
    let initialStepCount = 0;
    initialCompletedSteps?.forEach((step) => {
      if (step.patch) {
        machineInitialState = applyPatches(machineInitialState, [step.patch]) as JsonObject;
        initialStepCount++;
      }
    });

    // Create state machine with pre-populated state
    // The machine tracks: currentState, isTopLevel, topLevelStepCount, etc.
    const machine = createBrainExecutionMachine({ initialState: machineInitialState });

    // If loopEvents and response are provided, reconstruct loop context
    const loopResumeContext =
      loopEvents && response
        ? reconstructLoopContext(loopEvents, response)
        : null;

    const brainRun =
      brainRunId && initialCompletedSteps
        ? brain.run({
            initialState,
            initialCompletedSteps,
            brainRunId,
            options,
            client,
            resources: resources ?? {},
            pages,
            env: resolvedEnv,
            response,
            loopResumeContext,
          })
        : brain.run({
            initialState,
            options,
            client,
            brainRunId,
            resources: resources ?? {},
            pages,
            env: resolvedEnv,
          });

    try {
      for await (const event of brainRun) {
        // Check if we've been cancelled
        if (signal?.aborted) {
          // Use state machine to create cancelled event
          sendEvent(machine, { type: BRAIN_EVENTS.CANCELLED });
          const cancelledEvent = machine.context.currentEvent as unknown as BrainEvent<TOptions>;
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

        // Stop execution when machine enters paused state (webhook)
        if (machine.context.isPaused) {
          // Cast is safe: state started as TState and patches maintain the structure
          return machine.context.currentState as TState;
        }
      }
    } catch (error) {
      // If aborted while awaiting, check signal and emit cancelled event
      if (signal?.aborted) {
        sendEvent(machine, { type: BRAIN_EVENTS.CANCELLED });
        const cancelledEvent = machine.context.currentEvent as unknown as BrainEvent<TOptions>;
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
