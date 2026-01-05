import { BRAIN_EVENTS, STATUS } from './constants.js';
import { applyPatches } from './json-patch.js';
import { reconstructLoopContext } from './loop-messages.js';
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

    let currentState = initialState ?? ({} as TState);
    let stepNumber = 1;

    // Apply any patches from completed steps
    // to the initial state so that the brain
    // starts with a state that reflects all of the completed steps.
    // Need to do this when a brain is restarted with completed steps.
    // Note: Only apply top-level step patches, not innerSteps patches
    // (inner brain patches are applied to inner brain state, not outer brain state)
    initialCompletedSteps?.forEach((step) => {
      if (step.patch) {
        currentState = applyPatches(currentState, [step.patch]) as TState;
        stepNumber++;
      }
    });

    // Track brain nesting depth to know which STEP_COMPLETE events
    // belong to the top-level brain vs inner brains
    let brainDepth = 0;

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
          // Emit a cancelled event
          const cancelledEvent = {
            type: BRAIN_EVENTS.CANCELLED,
            status: STATUS.CANCELLED,
            brainTitle: brain.title,
            brainDescription: brain.structure.description,
            brainRunId: brainRunId || event.brainRunId,
            options: event.options,
          } as const;
          await Promise.all(adapters.map((adapter) => adapter.dispatch(cancelledEvent)));
          return currentState;
        }

        // Track brain nesting depth - START/RESTART increases, COMPLETE decreases
        if (event.type === BRAIN_EVENTS.START || event.type === BRAIN_EVENTS.RESTART) {
          brainDepth++;
        }

        // Dispatch event to all adapters
        await Promise.all(adapters.map((adapter) => adapter.dispatch(event)));

        // Update current state when steps complete
        // Only apply patches from top-level brain (depth === 1)
        // Inner brain patches are applied to inner brain state within brain.ts
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          if (event.patch && brainDepth === 1) {
            currentState = applyPatches(currentState, [event.patch]) as TState;
          }

          // Check if we should stop after this step (only for top-level steps)
          if (brainDepth === 1 && endAfter && stepNumber >= endAfter) {
            return currentState;
          }

          if (brainDepth === 1) {
            stepNumber++;
          }
        }

        // Track brain completion - decreases nesting depth
        if (event.type === BRAIN_EVENTS.COMPLETE) {
          brainDepth--;
        }

        // Stop execution when webhook event is encountered
        if (event.type === BRAIN_EVENTS.WEBHOOK) {
          return currentState;
        }
      }
    } catch (error) {
      // If aborted while awaiting, check signal and emit cancelled event
      if (signal?.aborted) {
        const cancelledEvent = {
          type: BRAIN_EVENTS.CANCELLED,
          status: STATUS.CANCELLED,
          brainTitle: brain.title,
          brainDescription: brain.structure.description,
          brainRunId: brainRunId || '',
          options: options || ({} as TOptions),
        } as const;
        await Promise.all(adapters.map((adapter) => adapter.dispatch(cancelledEvent)));
        return currentState;
      }
      throw error;
    }

    return currentState;
  }
}
