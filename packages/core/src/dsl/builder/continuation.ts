import type { Brain } from './brain.js';
import type { State, JsonObject, StepContext } from '../types.js';
import type { Block } from '../definitions/blocks.js';

export class Continuation<
  TOptions extends JsonObject,
  TState extends State,
  TServices extends object,
  TResponse
> {
  constructor(
    private addBlock: (block: Block<any, any, any, any, any, any>) => void,
    private createNextBrain: <TNewState extends State>() => Brain<
      TOptions,
      TNewState,
      TServices
    >
  ) {}

  handle<TNewState extends State>(
    title: string,
    action: (
      params: StepContext<TState, TOptions> &
        TServices & { response: TResponse }
    ) => TNewState | Promise<TNewState>
  ): Brain<TOptions, TNewState, TServices> {
    this.addBlock({
      type: 'step',
      title,
      action: action as any,
    });
    return this.createNextBrain<TNewState>();
  }

  guard(
    predicate: (params: { state: TState; options: TOptions }) => boolean,
    title?: string
  ): Continuation<TOptions, TState, TServices, TResponse> {
    this.addBlock({
      type: 'guard',
      title: title ?? 'Guard',
      predicate,
    });
    return new Continuation(this.addBlock, this.createNextBrain);
  }
}
