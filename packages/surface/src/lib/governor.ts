/**
 * Create a concurrency limiter that runs at most `max` async tasks at a time.
 * Excess tasks queue in FIFO order and start as earlier ones settle.
 */
export function governor(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < max) {
        active += 1;
        resolve();
      } else {
        queue.push(() => {
          active += 1;
          resolve();
        });
      }
    });

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
