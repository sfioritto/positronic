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
  initialManifest: M
) {
  function findResourceByPath(manifest: Manifest, path: string) {
    // Remove file extension to match manifest keys
    const pathWithoutExt = path.replace(/\.[^/.]+$/, '');
    const parts = pathWithoutExt.split('/');

    let current: Manifest | Entry = manifest;
    for (let i = 0; i < parts.length; i++) {
      current = current[parts[i]] as Manifest;
      if (!current) {
        throw new Error(`Resource not found: ${path}`);
      }

      const isLastPart = i === parts.length - 1;
      if (isLastPart) {
        if (isResourceEntry(current)) {
          return current;
        } else {
          throw new Error(`Resource entry not found: ${path}`);
        }
      }
    }

    throw new Error(`Resource not found: ${path}`);
  }

  function createProxiedResources(manifestNode: Manifest): Resources {
    // Create methods that will be shared across all instances
    const loadText = async (path: string): Promise<string> => {
      const entry = findResourceByPath(manifestNode, path);
      if (entry.type !== 'text') {
        throw new Error(
          `Resource "${path}" is of type "${entry.type}", but was accessed with loadText().`
        );
      }
      return loader.load(entry.key, 'text');
    };

    const loadBinary = async (path: string): Promise<Buffer> => {
      const entry = findResourceByPath(manifestNode, path);
      if (!entry) {
        throw new Error(`Resource not found: ${path}`);
      }
      if (entry.type !== 'binary') {
        throw new Error(
          `Resource "${path}" is of type "${entry.type}", but was accessed with loadBinary().`
        );
      }
      return loader.load(entry.key, 'binary');
    };

    const resultProxy: Resources = new Proxy({} as Resources, {
      get: (target, prop, receiver): any => {
        if (prop === 'loadText') {
          return loadText;
        }
        if (prop === 'loadBinary') {
          return loadBinary;
        }

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
          // manifestEntry is a nested Manifest
          const nestedResources = createProxiedResources(
            manifestEntry as Manifest
          );
          return nestedResources;
        }
      },
      has: (target, prop): boolean => {
        // Check for special methods
        if (prop === 'loadText' || prop === 'loadBinary') {
          return true;
        }
        // Then check manifest
        if (typeof prop === 'string') {
          return prop in manifestNode;
        }
        return Reflect.has(target, prop);
      },
      ownKeys: (target): string[] => {
        // Combine special methods with manifest keys
        return ['loadText', 'loadBinary', ...Object.keys(manifestNode)];
      },
      getOwnPropertyDescriptor: (
        target,
        prop
      ): PropertyDescriptor | undefined => {
        if (prop === 'loadText' || prop === 'loadBinary') {
          return {
            value: prop === 'loadText' ? loadText : loadBinary,
            writable: false,
            enumerable: true,
            configurable: true,
          };
        }

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

  return createProxiedResources(initialManifest);
}
