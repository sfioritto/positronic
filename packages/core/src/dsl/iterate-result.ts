export class IterateResult<TItem, TResult> {
  private data: { item: TItem; result: TResult }[];

  constructor(data: { item: TItem; result: TResult }[]) {
    this.data = data;
  }

  get length(): number {
    return this.data.length;
  }

  get items(): TItem[] {
    return this.data.map((d) => d.item);
  }

  get values(): TResult[] {
    return this.data.map((d) => d.result);
  }

  get entries(): [TItem, TResult][] {
    return this.data.map((d) => [d.item, d.result]);
  }

  filter(
    predicate: (item: TItem, result: TResult) => boolean
  ): IterateResult<TItem, TResult> {
    return new IterateResult(
      this.data.filter((d) => predicate(d.item, d.result))
    );
  }

  map<U>(fn: (item: TItem, result: TResult) => U): U[] {
    return this.data.map((d) => fn(d.item, d.result));
  }

  *[Symbol.iterator](): Iterator<[TItem, TResult]> {
    for (const d of this.data) {
      yield [d.item, d.result];
    }
  }

  toJSON(): { item: TItem; result: TResult }[] {
    return this.data;
  }
}
