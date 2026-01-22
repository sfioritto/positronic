import { v4 as uuidv4 } from 'uuid';
import { STATUS } from '../constants.js';
import type { JsonPatch } from '../types.js';
import type { SerializedStep } from '../definitions/steps.js';
import type { Block } from '../definitions/blocks.js';

export class Step {
  public id: string;
  private patch?: JsonPatch;
  private status: (typeof STATUS)[keyof typeof STATUS] = STATUS.PENDING;

  constructor(public block: Block<any, any, any, any, any, any>, id?: string) {
    this.id = id || uuidv4();
  }

  withPatch(patch: JsonPatch | undefined) {
    this.patch = patch;
    return this;
  }

  withStatus(status: (typeof STATUS)[keyof typeof STATUS]) {
    this.status = status;
    return this;
  }

  get serialized(): SerializedStep {
    return {
      id: this.id,
      title: this.block.title,
      status: this.status,
      patch:
        typeof this.patch === 'string' ? JSON.parse(this.patch) : this.patch,
    };
  }
}
