import {
  BUNDLE_KEY,
  createComponentRegistry,
  type ComponentRegistry,
  type UIComponent,
} from './types.js';

/**
 * Merge multiple component registries into one.
 * Later registries override earlier ones for component definitions.
 * Bundles are concatenated in order.
 *
 * @param registries - Component registries to merge
 * @returns A merged ComponentRegistry with concatenated bundles
 *
 * @example
 * ```typescript
 * import { components } from '@positronic/gen-ui-components';
 * import { myComponents } from './my-components';
 *
 * const merged = mergeComponents(components, myComponents);
 * runner.withComponents(merged);
 * ```
 */
export function mergeComponents(...registries: ComponentRegistry[]): ComponentRegistry {
  // Merge component definitions (later wins)
  const merged: Record<string, UIComponent<any>> = {};
  for (const registry of registries) {
    for (const [name, component] of Object.entries(registry)) {
      merged[name] = component;
    }
  }

  // Concatenate bundles
  const bundles = registries.map((r) => r[BUNDLE_KEY]).filter((b): b is string => !!b);

  const combinedBundle = bundles.join('\n');

  return createComponentRegistry(merged, combinedBundle);
}
