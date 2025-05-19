import { WORKFLOW_EVENTS } from './constants.js';
import { applyPatches } from './json-patch.js';
import type { Adapter } from '../adapters/types.js';
import type { SerializedStep, Workflow } from './workflow.js';
import type { State } from './types.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { ResourceLoader } from '../resources/resource-loader.js';
import type { Resources } from '../resources/resources.js';

export class WorkflowRunner {
  constructor(
    private options: {
      adapters: Adapter[];
      client: ObjectGenerator;
      resourceLoader: ResourceLoader;
    }
  ) {}

  withAdapters(adapters: Adapter[]): WorkflowRunner {
    const { adapters: existingAdapters } = this.options;
    return new WorkflowRunner({
      ...this.options,
      adapters: [...existingAdapters, ...adapters],
    });
  }

  withClient(client: ObjectGenerator): WorkflowRunner {
    return new WorkflowRunner({
      ...this.options,
      client,
    });
  }

  withResourceLoader(loader: ResourceLoader): WorkflowRunner {
    return new WorkflowRunner({
      ...this.options,
      resourceLoader: loader,
    });
  }

  async run<
    TOptions extends object = {},
    TState extends State = {},
    TResources extends Resources = Resources
  >(
    workflow: Workflow<TOptions, TState, any, TResources>,
    {
      initialState = {} as TState,
      options,
      initialCompletedSteps,
      workflowRunId,
      endAfter,
      resources = {} as TResources,
    }: {
      initialState?: TState;
      options?: TOptions;
      initialCompletedSteps?: SerializedStep[] | never;
      workflowRunId?: string | never;
      endAfter?: number;
      resources?: TResources;
    } = {}
  ): Promise<TState> {
    const { adapters, client, resourceLoader } = this.options;

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
        ? workflow.run({
            initialState,
            initialCompletedSteps,
            workflowRunId,
            options,
            client,
            resources,
          })
        : workflow.run({
            initialState,
            options,
            client,
            workflowRunId,
            resources,
          });

    for await (const event of workflowRun) {
      // Dispatch event to all adapters
      await Promise.all(adapters.map((adapter) => adapter.dispatch(event)));

      // Update current state when steps complete
      if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
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
