export class IterateResult<TItem, TResult> {
  private data: [TItem, TResult][];

  constructor(data: [TItem, TResult][]) {
    this.data = data;
  }

  get length(): number {
    return this.data.length;
  }

  get items(): TItem[] {
    return this.data.map(([item]) => item);
  }

  get values(): TResult[] {
    return this.data.map(([, result]) => result);
  }

  get entries(): [TItem, TResult][] {
    return [...this.data];
  }

  filter(
    predicate: (item: TItem, result: TResult) => boolean
  ): IterateResult<TItem, TResult> {
    return new IterateResult(
      this.data.filter(([item, result]) => predicate(item, result))
    );
  }

  map<U>(fn: (item: TItem, result: TResult) => U): U[] {
    return this.data.map(([item, result]) => fn(item, result));
  }

  [Symbol.iterator](): Iterator<[TItem, TResult]> {
    return this.data[Symbol.iterator]();
  }

  toJSON(): [TItem, TResult][] {
    return this.data;
  }
}
