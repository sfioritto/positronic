import type { WorkflowEvent } from '../dsl/workflow.js';

export interface Adapter<Options extends object = any> {
  dispatch(event: WorkflowEvent<Options>): void | Promise<void>;
}
