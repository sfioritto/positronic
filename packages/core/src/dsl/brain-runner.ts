import { BRAIN_EVENTS } from './constants.js';
import { applyPatches } from './json-patch.js';
import type { Adapter } from '../adapters/types.js';
import type { SerializedStep, Brain } from './workflow.js';
import type { State } from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { Resources } from '../resources/resources.js';

export class BrainRunner {
  constructor(
    private options: {
      adapters: Adapter[];
      client: ObjectGenerator;
      resources?: Resources;
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

  async run<TOptions extends object = {}, TState extends State = {}>(
    brain: Brain<TOptions, TState, any>,
    {
      initialState = {} as TState,
      options,
      initialCompletedSteps,
      workflowRunId,
      endAfter,
    }: {
      initialState?: TState;
      options?: TOptions;
      initialCompletedSteps?: SerializedStep[] | never;
      workflowRunId?: string | never;
      endAfter?: number;
    } = {}
  ): Promise<TState> {
    const { adapters, client, resources } = this.options;

    let currentState = initialState ?? ({} as TState);
    let stepNumber = 1;

    // Apply any patches from completed steps
    // to the initial state so that the workflow
    // starts with a state that reflects all of the completed steps.
    // Need to do this when a workflow is restarted with completed steps.
    initialCompletedSteps?.forEach((step) => {
      if (step.patch) {
        currentState = applyPatches(currentState, [step.patch]) as TState;
        stepNumber++;
      }
    });

    const workflowRun =
      workflowRunId && initialCompletedSteps
        ? brain.run({
            initialState,
            initialCompletedSteps,
            workflowRunId,
            options,
            client,
            resources: resources ?? {},
          })
        : brain.run({
            initialState,
            options,
            client,
            workflowRunId,
            resources: resources ?? {},
          });

    for await (const event of workflowRun) {
      // Dispatch event to all adapters
      await Promise.all(adapters.map((adapter) => adapter.dispatch(event)));

      // Update current state when steps complete
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        if (event.patch) {
          currentState = applyPatches(currentState, [event.patch]) as TState;
        }

        // Check if we should stop after this step
        if (endAfter && stepNumber >= endAfter) {
          return currentState;
        }

        stepNumber++;
      }
    }

    return currentState;
  }
}
