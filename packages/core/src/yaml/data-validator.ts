/**
 * Data validator for YAML templates.
 *
 * Validates that template bindings (like {{email.subject}}) reference
 * valid paths in the provided data structure.
 */

import type {
  ComponentNode,
  DataType,
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
