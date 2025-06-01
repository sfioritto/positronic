import { ResourceLoader } from './resource-loader.js';

// Runtime array of valid resource types
export const RESOURCE_TYPES = ['text', 'binary'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface Entry {
  type: ResourceType;
  path: string; // File path - used during build process
  key: string; // R2 object key (original filename with path)
}

export interface Manifest {
  [key: string]: ManifestEntry;
}

type ManifestEntry = Entry | Manifest;

interface Resource {
  load: () => Promise<string | Buffer>;
  loadText: () => Promise<string>;
  loadBinary: () => Promise<Buffer>;
}

export interface Resources {
  [key: string]: Resource | Resources;
}

function isResourceEntry(entry: ManifestEntry): entry is Entry {
  return typeof (entry as Entry).type === 'string';
}

export function createResources<M extends Manifest>(
  loader: ResourceLoader,
  initialManifestWithCamelCaseKeys: M
) {
  function createProxiedResources(manifestNode: Manifest): Resources {
    const resultProxy: Resources = new Proxy({} as Resources, {
      get: (target, prop, receiver): Resource | Resources | undefined => {
        if (typeof prop !== 'string' || !(prop in manifestNode)) {
          return Reflect.get(target, prop, receiver);
        }

        const manifestEntry = manifestNode[prop];

        if (isResourceEntry(manifestEntry)) {
          const { key, type } = manifestEntry;
          const apiObject: Resource = {
            load: () =>
              manifestEntry.type === 'text'
                ? loader.load(key, 'text')
                : loader.load(key, 'binary'),
            loadText: () => {
              if (type !== 'text') {
                throw new Error(
                  `Resource "${prop}" is of type "${type}", but was accessed with loadText().`
                );
              }
              return loader.load(key, 'text');
            },
            loadBinary: () => {
              if (type !== 'binary') {
                throw new Error(
                  `Resource "${prop}" is of type "${type}", but was accessed with loadBinary().`
                );
              }
              return loader.load(key, 'binary');
            },
          };
          return apiObject;
        } else {
          // manifestEntry is a nested Manifest (already with camelCase keys)
          const nestedResources = createProxiedResources(
            manifestEntry as Manifest
          );
          return nestedResources;
        }
      },
      has: (target, prop): boolean => {
        if (typeof prop === 'string') {
          return prop in manifestNode;
        }
        return Reflect.has(target, prop);
      },
      ownKeys: (): string[] => {
        return Object.keys(manifestNode);
      },
      getOwnPropertyDescriptor: (
        target,
        prop
      ): PropertyDescriptor | undefined => {
        if (typeof prop === 'string' && prop in manifestNode) {
          const value: Resource | Resources | undefined =
            resultProxy[prop as keyof Resources];
          if (value === undefined) {
            return undefined;
          }
          return {
            value,
            writable: false,
            enumerable: true,
            configurable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });

    return resultProxy;
  }

  return createProxiedResources(initialManifestWithCamelCaseKeys);
}
