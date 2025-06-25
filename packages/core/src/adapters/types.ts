import type { BrainEvent } from '../dsl/workflow.js';

export interface Adapter<Options extends object = any> {
  dispatch(event: BrainEvent<Options>): void | Promise<void>;
}
