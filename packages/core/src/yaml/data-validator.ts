/**
 * Data validator for YAML templates.
 *
 * Validates that template bindings (like {{email.subject}}) reference
 * valid paths in the provided data structure.
 */

import type {
  ComponentNode,
  DataType,
  ResolvedBinding,
  ValidationError,
  ValidationResult,
} from './types.js';

/**
 * Loop context tracks variables introduced by List/Each components.
 * Maps variable name to the element type of the array being iterated.
 */
type LoopContext = Map<string, DataType>;

/**
 * Infer a DataType from a sample JavaScript value.
 */
export function inferDataType(value: unknown): DataType {
  if (value === null) {
    return { kind: 'primitive', type: 'null' };
  }

  if (typeof value === 'string') {
    return { kind: 'primitive', type: 'string' };
  }

  if (typeof value === 'number') {
    return { kind: 'primitive', type: 'number' };
  }

  if (typeof value === 'boolean') {
    return { kind: 'primitive', type: 'boolean' };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'array', elementType: { kind: 'unknown' } };
    }
    // Infer element type from first element
    return { kind: 'array', elementType: inferDataType(value[0]) };
  }

  if (typeof value === 'object') {
    const properties: Record<string, DataType> = {};
    for (const [key, val] of Object.entries(value)) {
      properties[key] = inferDataType(val);
    }
    return { kind: 'object', properties };
  }

  return { kind: 'unknown' };
}

/**
 * Resolve a binding path against a data type, considering loop context.
 *
 * @param path - The binding path like "email.subject" or "emails"
 * @param rootType - The root data type
 * @param loopContext - Map of loop variable names to their types
 * @returns The resolved DataType or null if path is invalid
 */
export function resolvePathType(
  path: string,
  rootType: DataType,
  loopContext: LoopContext
): DataType | null {
  const segments = path.split('.');
  const firstSegment = segments[0];

  // Check if first segment is a loop variable
  if (loopContext.has(firstSegment)) {
    let current = loopContext.get(firstSegment)!;
    for (const segment of segments.slice(1)) {
      if (current.kind !== 'object') {
        return null;
      }
      if (!(segment in current.properties)) {
        return null;
      }
      current = current.properties[segment];
    }
    return current;
  }

  // Otherwise resolve against root type
  let current = rootType;
  for (const segment of segments) {
    if (current.kind !== 'object') {
      return null;
    }
    if (!(segment in current.properties)) {
      return null;
    }
    current = current.properties[segment];
  }
  return current;
}

/**
 * Validate all data bindings in a component tree.
 *
 * @param root - The root ComponentNode
 * @param dataType - The inferred type of the available data
 * @returns ValidationResult with any errors found
 */
export function validateDataBindings(
  root: ComponentNode,
  dataType: DataType
): ValidationResult {
  const errors: ValidationError[] = [];

  function validateNode(node: ComponentNode, loopContext: LoopContext): void {
    // Check all props for bindings
    for (const [propName, propValue] of Object.entries(node.props)) {
      if (propValue.type === 'binding') {
        const resolved = resolvePathType(propValue.path, dataType, loopContext);
        if (resolved === null) {
          errors.push({
            type: 'invalid-binding',
            message: `Invalid binding path "{{${propValue.path}}}" in ${node.component}.${propName}`,
            path: propValue.path,
          });
        }
      }
    }

    // Handle List/Each components that create loop context
    if (node.component === 'List' || node.component === 'Each') {
      const itemsProp = node.props.items;
      const asProp = node.props.as;

      if (itemsProp?.type === 'binding') {
        const itemsType = resolvePathType(itemsProp.path, dataType, loopContext);

        if (itemsType && itemsType.kind === 'array') {
          // Create new loop context with the loop variable
          const varName =
            asProp?.type === 'literal' && typeof asProp.value === 'string'
              ? asProp.value
              : 'item';

          const newContext = new Map(loopContext);
          newContext.set(varName, itemsType.elementType);

          // Validate children with the new context
          for (const child of node.children) {
            validateNode(child, newContext);
          }
          return;
        }
      }
    }

    // Validate children with current context
    for (const child of node.children) {
      validateNode(child, loopContext);
    }
  }

  validateNode(root, new Map());

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Loop data context maps loop variable names to their sample values.
 */
type LoopDataContext = Map<string, unknown>;

/**
 * Resolve a binding path against actual data, considering loop context.
 *
 * @param path - The binding path like "email.subject"
 * @param rootData - The root data object
 * @param loopDataContext - Map of loop variable names to sample values
 * @returns The resolved value, or undefined if the path doesn't resolve
 */
export function resolvePathValue(
  path: string,
  rootData: Record<string, unknown>,
  loopDataContext: LoopDataContext
): unknown {
  const segments = path.split('.');
  const firstSegment = segments[0];

  // Check if first segment is a loop variable
  let current: unknown;
  if (loopDataContext.has(firstSegment)) {
    current = loopDataContext.get(firstSegment);
    for (const segment of segments.slice(1)) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  // Otherwise resolve against root data
  current = rootData;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Summarize a value for LLM consumption.
 * Keeps output compact — no full data dumps.
 */
export function summarizeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  if (typeof value === 'string') {
    if (value.length <= 60) return JSON.stringify(value);
    return JSON.stringify(value.slice(0, 57) + '...');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 'Array(0) []';
    const firstPreview = summarizeValue(value[0]);
    return `Array(${value.length}) [${firstPreview}, ...]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    const keyPreview = keys.slice(0, 5).join(', ');
    const suffix = keys.length > 5 ? ', ...' : '';
    return `{ ${keyPreview}${suffix} } (${keys.length} keys)`;
  }

  return String(value);
}

/**
 * Walk the ComponentNode tree and resolve every binding against real data.
 *
 * @param root - The root ComponentNode
 * @param data - The actual data object
 * @returns Array of ResolvedBinding entries
 */
export function resolveBindings(
  root: ComponentNode,
  data: Record<string, unknown>
): ResolvedBinding[] {
  const results: ResolvedBinding[] = [];

  function walkNode(
    node: ComponentNode,
    loopDataContext: LoopDataContext
  ): void {
    // Check all props for bindings
    for (const [propName, propValue] of Object.entries(node.props)) {
      if (propValue.type === 'binding') {
        const value = resolvePathValue(propValue.path, data, loopDataContext);
        results.push({
          path: propValue.path,
          component: node.component,
          prop: propName,
          value: summarizeValue(value),
          resolved: value !== undefined,
        });
      }
    }

    // Handle List/Each components that create loop context
    if (node.component === 'List' || node.component === 'Each') {
      const itemsProp = node.props.items;
      const asProp = node.props.as;

      if (itemsProp?.type === 'binding') {
        const itemsValue = resolvePathValue(itemsProp.path, data, loopDataContext);

        if (Array.isArray(itemsValue)) {
          const varName =
            asProp?.type === 'literal' && typeof asProp.value === 'string'
              ? asProp.value
              : 'item';

          const newContext = new Map(loopDataContext);

          if (itemsValue.length > 0) {
            // Use first element as sample for loop variable
            newContext.set(varName, itemsValue[0]);
          }
          // If array is empty, don't set loop variable —
          // bindings inside will resolve to undefined

          for (const child of node.children) {
            walkNode(child, newContext);
          }
          return;
        }
      }
    }

    // Walk children with current context
    for (const child of node.children) {
      walkNode(child, loopDataContext);
    }
  }

  walkNode(root, new Map());
  return results;
}
