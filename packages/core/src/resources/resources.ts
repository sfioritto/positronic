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
  // Helper function to find a resource entry by path in the manifest
  function findResourceByPath(manifest: Manifest, path: string): Entry | null {
    const parts = path.split('/');

    let current: Manifest | Entry = manifest;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (isResourceEntry(current)) {
        // We hit a resource entry before consuming all parts
        return null;
      }

      const currentManifest = current as Manifest;
      const next = currentManifest[part];
      if (!next) {
        // If exact match not found and this is the last part, try without extension
        if (i === parts.length - 1) {
          const partWithoutExt = part.replace(/\.[^/.]+$/, '');
          const currentManifest = current as Manifest; // We know it's a Manifest since we checked isResourceEntry above
          const matches = Object.keys(currentManifest).filter((key) => {
            const keyWithoutExt = key.replace(/\.[^/.]+$/, '');
            return (
              keyWithoutExt === partWithoutExt &&
              isResourceEntry(currentManifest[key])
            );
          });

          if (matches.length === 1) {
            return currentManifest[matches[0]] as Entry;
          } else if (matches.length > 1) {
            throw new Error(
              `Ambiguous resource path '${path}': found ${matches.join(
                ', '
              )}. ` + `Please specify the full filename with extension.`
            );
          }
        }
        return null;
      }

      if (i === parts.length - 1 && isResourceEntry(next)) {
        // Found the resource
        return next;
      }

      current = next as Manifest;
    }

    return null;
  }

  function createProxiedResources(manifestNode: Manifest): Resources {
    // Create methods that will be shared across all instances
    const loadText = async (path: string): Promise<string> => {
      const entry = findResourceByPath(manifestNode, path);
      if (!entry) {
        throw new Error(`Resource not found: ${path}`);
      }
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

        // Handle dynamic resource properties
        if (typeof prop !== 'string') {
          return Reflect.get(target, prop, receiver);
        }

        // Check if the property exists directly (with extension)
        if (prop in manifestNode) {
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
        }

        // If not found directly, check for files without extension
        // Find all keys that match when extension is removed
        const matches = Object.keys(manifestNode).filter((key) => {
          const keyWithoutExt = key.replace(/\.[^/.]+$/, '');
          return keyWithoutExt === prop && isResourceEntry(manifestNode[key]);
        });

        if (matches.length === 0) {
          // No matches - might be a nested directory
          if (prop in manifestNode && !isResourceEntry(manifestNode[prop])) {
            return createProxiedResources(manifestNode[prop] as Manifest);
          }
          return undefined;
        }

        if (matches.length === 1) {
          // Single match - return it
          const manifestEntry = manifestNode[matches[0]] as Entry;
          const { key, type } = manifestEntry;
          const apiObject: Resource = {
            load: () =>
              type === 'text'
                ? loader.load(key, 'text')
                : loader.load(key, 'binary'),
            loadText: () => {
              if (type !== 'text') {
                throw new Error(
                  `Resource "${matches[0]}" is of type "${type}", but was accessed with loadText().`
                );
              }
              return loader.load(key, 'text');
            },
            loadBinary: () => {
              if (type !== 'binary') {
                throw new Error(
                  `Resource "${matches[0]}" is of type "${type}", but was accessed with loadBinary().`
                );
              }
              return loader.load(key, 'binary');
            },
          };
          return apiObject;
        }

        // Multiple matches - throw helpful error
        throw new Error(
          `Ambiguous resource name '${prop}': found ${matches.join(', ')}. ` +
            `Please use resources.loadText('${matches[0]}') or resources.loadBinary('${matches[1]}') instead.`
        );
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
