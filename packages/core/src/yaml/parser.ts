/**
 * YAML parser for UI templates.
 *
 * Parses YAML strings into a ComponentNode AST. Uses the {{path}} syntax
 * to detect binding expressions that will be resolved at render time.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ComponentNode, PropValue, Template } from './types.js';

// Regex to match binding expressions like {{path}} or {{item.field}}
const BINDING_REGEX = /^\{\{(.+)\}\}$/;

/**
 * Parse a prop value from YAML into either a binding or literal.
 */
function parsePropValue(value: unknown): PropValue {
  if (typeof value === 'string') {
    const match = value.match(BINDING_REGEX);
    if (match) {
      return { type: 'binding', path: match[1].trim() };
    }
    return { type: 'literal', value };
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return { type: 'literal', value };
  }

  // For arrays or objects that aren't component definitions, treat as literals
  return { type: 'literal', value: String(value) };
}

/**
 * Parse a single component node from the YAML object.
 *
 * YAML format:
 * ```yaml
 * Form:
 *   action: "/submit"
 *   children:
 *     - Input:
 *         name: "email"
 *         label: "{{labels.email}}"
 * ```
 */
function parseComponentNode(obj: Record<string, unknown>): ComponentNode {
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new Error(
      `Component object must have exactly one key (the component name), got: ${keys.join(', ')}`
    );
  }

  const component = keys[0];
  const propsOrChildren = obj[component];

  // Handle case where component has no props (just the name)
  if (propsOrChildren === null || propsOrChildren === undefined) {
    return { component, props: {}, children: [] };
  }

  if (typeof propsOrChildren !== 'object' || Array.isArray(propsOrChildren)) {
    throw new Error(
      `Component "${component}" props must be an object, got: ${typeof propsOrChildren}`
    );
  }

  const rawProps = propsOrChildren as Record<string, unknown>;
  const props: Record<string, PropValue> = {};
  let children: ComponentNode[] = [];

  for (const [key, value] of Object.entries(rawProps)) {
    if (key === 'children') {
      // Children is an array of component nodes
      if (!Array.isArray(value)) {
        throw new Error(
          `"children" must be an array in component "${component}"`
        );
      }
      children = value.map((child) => {
        if (typeof child !== 'object' || child === null) {
          throw new Error(
            `Child must be a component object in "${component}"`
          );
        }
        return parseComponentNode(child as Record<string, unknown>);
      });
    } else {
      // Regular prop
      props[key] = parsePropValue(value);
    }
  }

  return { component, props, children };
}

/**
 * Parse a YAML template string into a Template AST.
 *
 * @param yamlString - The YAML template to parse
 * @returns The parsed Template with root ComponentNode
 * @throws Error if YAML is invalid or doesn't match expected structure
 */
export function parseTemplate(yamlString: string): Template {
  const parsed = parseYaml(yamlString);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Template must be a YAML object');
  }

  const root = parseComponentNode(parsed as Record<string, unknown>);
  return { root };
}

/**
 * Convert a Template back to YAML string (for debugging).
 */
export function stringifyTemplate(template: Template): string {
  function nodeToObject(node: ComponentNode): Record<string, unknown> {
    const propsObj: Record<string, unknown> = {};

    for (const [key, propValue] of Object.entries(node.props)) {
      if (propValue.type === 'binding') {
        propsObj[key] = `{{${propValue.path}}}`;
      } else {
        propsObj[key] = propValue.value;
      }
    }

    if (node.children.length > 0) {
      propsObj.children = node.children.map(nodeToObject);
    }

    return { [node.component]: Object.keys(propsObj).length > 0 ? propsObj : null };
  }

  return stringifyYaml(nodeToObject(template.root));
}
