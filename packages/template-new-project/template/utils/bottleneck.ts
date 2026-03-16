type BottleneckConfig =
  | { rps: number; rpm?: never; rph?: never; rpd?: never }
  | { rpm: number; rps?: never; rph?: never; rpd?: never }
  | { rph: number; rps?: never; rpm?: never; rpd?: never }
  | { rpd: number; rps?: never; rpm?: never; rph?: never };

export function bottleneck(config: BottleneckConfig) {
  const interval = configToInterval(config);
  let next = 0;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const delay = Math.max(0, next - now);
    next = Math.max(now, next) + interval;
    if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
    return fn();
  };
}

function configToInterval(config: BottleneckConfig) {
  if ('rps' in config && config.rps !== undefined) return 1000 / config.rps;
  if ('rpm' in config && config.rpm !== undefined) return 60_000 / config.rpm;
  if ('rph' in config && config.rph !== undefined) return 3_600_000 / config.rph;
  if ('rpd' in config && config.rpd !== undefined) return 86_400_000 / config.rpd;
  return 0;
}
