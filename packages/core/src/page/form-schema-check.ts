import type { Spec, UIElement } from '@json-render/core';
import type { z } from 'zod';
import type { PageCatalog } from './schema.js';
import { schemaType, unwrapSchema } from './form-data.js';

const FORM_PREFIX = '/form/';

/** What a bound input yields, or what a form schema field expects. */
type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

interface BoundField {
  name: string;
  component: string;
  prop: string;
  type: FieldType | undefined;
}

function scalarType(schema: z.ZodTypeAny): FieldType | undefined {
  const inner = unwrapSchema(schema);
  switch (schemaType(inner)) {
    case 'string':
    case 'enum':
    case 'literal':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array': {
      const element = scalarType((inner as any)._zod.def.element);
      return element && !element.endsWith('[]')
        ? (`${element}[]` as FieldType)
        : undefined;
    }
    default:
      return undefined;
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  return schema.safeParse(undefined).success;
}

/**
 * Describe the fields a form schema expects, for the generation prompt.
 */
export function describeFormFields(formSchema: z.ZodObject<any>): string {
  return Object.entries<z.ZodTypeAny>(formSchema.shape)
    .map(([name, field]) => {
      const inner = unwrapSchema(field);
      const type =
        schemaType(inner) === 'enum'
          ? Object.values(
              (inner as any)._zod.def.entries as Record<string, string>
            )
              .map((option) => JSON.stringify(option))
              .join(' | ')
          : (scalarType(field) ?? 'unknown');
      const description = field.description ? ` - ${field.description}` : '';
      return `- ${name}: ${type}${isOptional(field) ? ' (optional)' : ''}${description}`;
    })
    .join('\n');
}

/**
 * Find every `{ $bindState: "/form/<field>" }` in an element's props, keyed by
 * the prop it sits on. Only top-level props are inspected: form bindings
 * live on `value`, `checked`, and the like.
 */
function formBindings(
  props: Record<string, unknown>
): Array<{ prop: string; name: string }> {
  const bindings: Array<{ prop: string; name: string }> = [];
  for (const [prop, value] of Object.entries(props)) {
    if (value !== null && typeof value === 'object' && '$bindState' in value) {
      const path = (value as { $bindState: unknown }).$bindState;
      if (typeof path === 'string' && path.startsWith(FORM_PREFIX)) {
        bindings.push({
          prop,
          name: path.slice(FORM_PREFIX.length).split('/')[0],
        });
      }
    }
  }
  return bindings;
}

/**
 * The type a bound prop yields at submit time, read from the catalog's prop
 * schema. A boolean binding next to a `value` prop is a checkbox-group entry
 * and yields the value; anything inside a repeat yields one entry per item.
 */
function boundType(
  catalog: PageCatalog,
  element: UIElement,
  prop: string,
  insideRepeat: boolean
): FieldType | undefined {
  const propsSchema = catalog.data.components[element.type]?.props;
  const shape = (propsSchema as z.ZodObject<any> | undefined)?.shape;
  const propSchema: z.ZodTypeAny | undefined = shape?.[prop];
  if (!propSchema) return undefined;

  let type = scalarType(propSchema);
  if (type === 'boolean' && element.props.value !== undefined) {
    type = 'string';
  }
  if (type && insideRepeat && !type.endsWith('[]')) {
    return `${type}[]` as FieldType;
  }
  return type;
}

function collectBoundFields(spec: Spec, catalog: PageCatalog): BoundField[] {
  const fields: BoundField[] = [];
  const visited = new Set<string>();

  const visit = (key: string, insideRepeat: boolean) => {
    const element = spec.elements[key];
    if (!element || visited.has(key)) return;
    visited.add(key);

    for (const { prop, name } of formBindings(element.props ?? {})) {
      fields.push({
        name,
        component: element.type,
        prop,
        type: boundType(catalog, element, prop, insideRepeat),
      });
    }

    const repeats = insideRepeat || element.repeat !== undefined;
    const childKeys = [
      ...(element.children ?? []),
      ...Object.values(element.slots ?? {}).flat(),
    ];
    for (const child of childKeys) visit(child, repeats);
  };

  visit(spec.root, false);
  return fields;
}

// Form encoding is text, so a text input satisfies a number field.
function yieldsCompatible(got: FieldType, want: FieldType): boolean {
  return got === want || got === want.replace('number', 'string');
}

function triggersAction(spec: Spec, action: string): boolean {
  return Object.values(spec.elements).some((element) =>
    Object.values(element.on ?? {})
      .flat()
      .some((binding) => binding.action === action)
  );
}

/**
 * Check that a spec's form bindings will produce a submission matching the
 * step's form schema: every required field is bound, nothing unexpected is
 * bound, bound inputs yield the expected types, and something submits.
 */
export function checkFormSchema(
  spec: Spec,
  catalog: PageCatalog,
  formSchema: z.ZodObject<any>
): string[] {
  const issues: string[] = [];
  const expected = Object.entries<z.ZodTypeAny>(formSchema.shape);
  const expectedNames = expected.map(([name]) => name);
  const bound = collectBoundFields(spec, catalog);
  const boundNames = new Set(bound.map((field) => field.name));

  for (const [name, fieldSchema] of expected) {
    if (!boundNames.has(name) && !isOptional(fieldSchema)) {
      issues.push(
        `Missing form field "${name}": bind an input's value prop with {"$bindState":"/form/${name}"} and set its name prop to "${name}".`
      );
    }
  }

  for (const field of bound) {
    if (!expectedNames.includes(field.name)) {
      issues.push(
        `"/form/${field.name}" is not an expected form field. Only bind: ${expectedNames.join(', ')}.`
      );
      continue;
    }
    const want = scalarType(formSchema.shape[field.name]);
    if (field.type && want && !yieldsCompatible(field.type, want)) {
      issues.push(
        `Form field "${field.name}" is bound on ${field.component}.${field.prop}, which yields ${field.type}, but the form expects ${want}.`
      );
    }
  }

  if (
    catalog.actionNames.includes('submitForm') &&
    !triggersAction(spec, 'submitForm')
  ) {
    issues.push(
      'Nothing submits the form: add a Button with "on": { "press": [{ "action": "validateForm" }, { "action": "submitForm" }] }.'
    );
  }

  return issues;
}
