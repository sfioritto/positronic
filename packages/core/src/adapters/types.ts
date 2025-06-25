import type { BrainEvent } from '../dsl/brain.js';

export interface Adapter<Options extends object = any> {
  dispatch(event: BrainEvent<Options>): void | Promise<void>;
}
