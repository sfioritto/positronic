import { ResourceLoader } from './resource-loader.js';

interface Entry {
  type: 'text' | 'binary';
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
          const apiObject: Resource = {
            load: () =>
              manifestEntry.type === 'text'
                ? loader.load(prop, 'text')
                : loader.load(prop, 'binary'),
            loadText: () => {
              if (manifestEntry.type !== 'text') {
                throw new Error(
                  `Resource "${prop}" is of type "${manifestEntry.type}", but was accessed with loadText().`
                );
              }
              return loader.load(prop, 'text');
            },
            loadBinary: () => {
              if (manifestEntry.type !== 'binary') {
                throw new Error(
                  `Resource "${prop}" is of type "${manifestEntry.type}", but was accessed with loadBinary().`
                );
              }
              return loader.load(prop, 'binary');
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
