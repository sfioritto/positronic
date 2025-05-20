import { ResourceLoader } from './resource-loader.js';

export interface ManifestEntry {
  type: 'text' | 'binary';
}

export type Manifest = Record<string, ManifestEntry>;

export interface Resources {
  [key: string]: {
    load: () => Promise<string | Buffer>;
  };
}

function toCamelCase(str: string): string {
  return str.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

export function createResources(
  loader: ResourceLoader,
  manifest: Manifest
): Resources {
  const processedManifest: Manifest = Object.fromEntries(
    Object.entries(manifest).map(([kebabCaseKey, entryData]) => {
      const camelCaseKey = toCamelCase(kebabCaseKey);
      return [camelCaseKey, entryData];
    })
  );

  return new Proxy({} as Resources, {
    get: (target, prop, receiver) => {
      if (typeof prop === 'string' && prop in processedManifest) {
        const entry = processedManifest[prop];
        return {
          load: () => {
            if (entry.type === 'text') {
              return loader.load(prop, 'text');
            } else {
              return loader.load(prop, 'binary');
            }
          },
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    has: (target, prop) => {
      if (typeof prop === 'string') {
        return prop in processedManifest;
      }
      return Reflect.has(target, prop);
    },
    ownKeys: () => {
      return Object.keys(processedManifest);
    },
    getOwnPropertyDescriptor: (target, prop) => {
      if (typeof prop === 'string' && prop in processedManifest) {
        const entry = processedManifest[prop];
        return {
          value: {
            load: () => {
              if (entry.type === 'text') {
                return loader.load(prop, 'text');
              } else {
                return loader.load(prop, 'binary');
              }
            },
          },
          writable: false,
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
}
