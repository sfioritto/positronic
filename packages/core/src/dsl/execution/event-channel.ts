/**
 * Simple async queue for passing events between a service (producer)
 * and the event stream (consumer) during step execution.
 *
 * The event stream uses Promise.race between the step completing and
 * channel.wait() to yield events mid-step without blocking.
 */
export class EventChannel<T> {
  private queue: T[] = [];
  private waiter: (() => void) | null = null;

  push(item: T) {
    this.queue.push(item);
    if (this.waiter) {
      this.waiter();
      this.waiter = null;
    }
  }

  /** Resolves when at least one item is in the queue, or immediately if non-empty */
  wait(): Promise<void> {
    if (this.queue.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  drain(): T[] {
    const items = this.queue;
    this.queue = [];
    return items;
  }
}
