import { WORKFLOW_EVENTS } from '../dsl/constants';
import type { WorkflowEvent } from '../dsl/workflow';

export abstract class Adapter<Options extends object = any> {
  async started?(event: WorkflowEvent<Options>): Promise<void>;
  async updated?(event: WorkflowEvent<Options>): Promise<void>;
  async completed?(event: WorkflowEvent<Options>): Promise<void>;
  async error?(event: WorkflowEvent<Options>): Promise<void>;
  async restarted?(event: WorkflowEvent<Options>): Promise<void>;

  async dispatch(event: WorkflowEvent<Options>) {
    if (event.type === WORKFLOW_EVENTS.START && this.started) {
      await this.started(event);
    } else if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE && this.updated) {
      await this.updated(event);
    } else if (event.type === WORKFLOW_EVENTS.COMPLETE && this.completed) {
      await this.completed(event);
    } else if (event.type === WORKFLOW_EVENTS.ERROR && this.error) {
      await this.error(event);
    } else if (event.type === WORKFLOW_EVENTS.RESTART && this.restarted) {
      await this.restarted(event);
    }
  }
}
