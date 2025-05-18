import { ResourceLoader } from './resource-loader.js';

export interface ManifestEntry {
  key: string;
  type: 'text' | 'binary';
}

export type Manifest = Record<string, ManifestEntry>;

export class Resources {
  constructor(public loader: ResourceLoader, public manifest: Manifest) {}

  public getResource(propertyName: string) {
    const entry = this.manifest[propertyName];
    if (!entry) {
      throw new Error(
        `Resource "${propertyName}" not found in resource manifest.`
      );
    }

    if (entry.type === 'text') {
      return this.loader.load(entry.key, 'text');
    } else {
      return this.loader.load(entry.key, 'binary');
    }
  }
}

export function createResources<T extends object>(
  loader: ResourceLoader,
  manifest: Manifest
) {
  const resources = new Resources(loader, manifest);

  return new Proxy(resources, {
    get: (target, prop, receiver) => {
      if (typeof prop === 'string') {
        if (Object.prototype.hasOwnProperty.call(target.manifest, prop)) {
          return target.getResource(prop);
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    has: (target, prop) => {
      if (typeof prop === 'string') {
        return Object.prototype.hasOwnProperty.call(target.manifest, prop);
      }
      return Reflect.has(target, prop);
    },
    ownKeys: (target) => {
      return Object.keys(target.manifest);
    },
    getOwnPropertyDescriptor: (target, prop) => {
      if (
        typeof prop === 'string' &&
        Object.prototype.hasOwnProperty.call(target.manifest, prop)
      ) {
        return {
          value: target.getResource(prop),
          writable: false,
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as T;
}
