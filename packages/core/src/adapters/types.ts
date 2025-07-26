import type { BrainEvent } from '../dsl/brain.js';
import type { JsonObject } from '../dsl/types.js';

export interface Adapter<Options extends JsonObject = any> {
  dispatch(event: BrainEvent<Options>): void | Promise<void>;
}
