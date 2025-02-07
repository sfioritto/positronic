import { WORKFLOW_EVENTS } from '../dsl/constants';
import type { Event } from '../dsl/workflow';

export abstract class Adapter<Options extends object = any> {
  async started?(event: Event<any, any, Options>): Promise<void>;
  async updated?(event: Event<any, any, Options>): Promise<void>;
  async completed?(event: Event<any, any, Options>): Promise<void>;
  async error?(event: Event<any, any, Options>): Promise<void>;
  async restarted?(event: Event<any, any, Options>): Promise<void>;

  async dispatch(event: Event<any, any, Options>) {
    if (event.type === WORKFLOW_EVENTS.START && this.started) {
      await this.started(event);
    } else if (event.type === WORKFLOW_EVENTS.UPDATE && this.updated) {
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
