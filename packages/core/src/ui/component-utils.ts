import type { UIComponent } from './types.js';

/**
 * Merge multiple component objects into one.
 * Later objects override earlier ones for component definitions.
 *
 * @param componentSets - Component objects to merge
 * @returns A merged component object
 *
 * @example
 * ```typescript
 * import { components } from '@positronic/gen-ui-components';
 * import { myComponents } from './my-components';
 *
 * const merged = mergeComponents(components, myComponents);
 * brain.withComponents(merged);
 * ```
 */
export function mergeComponents(
  ...componentSets: Record<string, UIComponent<any>>[]
): Record<string, UIComponent<any>> {
  const merged: Record<string, UIComponent<any>> = {};
  for (const set of componentSets) {
    for (const [name, component] of Object.entries(set)) {
      merged[name] = component;
    }
  }
  return merged;
}
