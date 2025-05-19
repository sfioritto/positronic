import { ResourceLoader } from './resource-loader.js';

export interface ManifestEntry {
  key: string;
  type: 'text' | 'binary';
}

export type Manifest = Record<string, ManifestEntry>;

export interface Resources {
  [key: string]: string | Buffer;
}

export function createResources(
  loader: ResourceLoader,
  manifest: Manifest
): Resources {
  function getResource(propertyName: string) {
    const entry = manifest[propertyName];
    if (!entry) {
      throw new Error(
        `Resource "${propertyName}" not found in resource manifest.`
      );
    }
    if (entry.type === 'text') {
      return loader.load(entry.key, 'text');
    } else {
      return loader.load(entry.key, 'binary');
    }
  }

  return new Proxy({} as Resources, {
    get: (target, prop, receiver) => {
      if (typeof prop === 'string') {
        if (Object.prototype.hasOwnProperty.call(manifest, prop)) {
          return getResource(prop);
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    has: (target, prop) => {
      if (typeof prop === 'string') {
        return Object.prototype.hasOwnProperty.call(manifest, prop);
      }
      return Reflect.has(target, prop);
    },
    ownKeys: () => {
      return Object.keys(manifest);
    },
    getOwnPropertyDescriptor: (target, prop) => {
      if (
        typeof prop === 'string' &&
        Object.prototype.hasOwnProperty.call(manifest, prop)
      ) {
        return {
          value: getResource(prop),
          writable: false,
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
}
