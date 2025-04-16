import { WORKFLOW_EVENTS } from '../dsl/constants.js';
import type { WorkflowEvent } from '../dsl/workflow.js';

export interface Adapter<Options extends object = any> {
  started?(event: WorkflowEvent<Options>): void | Promise<void>;
  updated?(event: WorkflowEvent<Options>): void | Promise<void>;
  completed?(event: WorkflowEvent<Options>): void | Promise<void>;
  error?(event: WorkflowEvent<Options>): void | Promise<void>;
  restarted?(event: WorkflowEvent<Options>): void | Promise<void>;

  dispatch(event: WorkflowEvent<Options>): void | Promise<void>;
}
