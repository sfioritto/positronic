/**
 * Schema extractor for YAML templates.
 *
 * Extracts the form schema that will be produced by the template's form fields.
 * Also validates extracted schema against expected Zod schemas.
 */

import { z, type ZodType, type ZodTypeDef } from 'zod';
import type {
  ComponentNode,
  ExtractedFormSchema,
  FormField,
  FormFieldType,
  ValidationError,
} from './types.js';

/**
 * Map of component names to their form field types.
 */
const FORM_COMPONENTS: Record<string, FormFieldType> = {
  Input: 'string',
  TextInput: 'string',
  NumberInput: 'number',
  Checkbox: 'boolean',
  Select: 'string',
  RadioGroup: 'string',
  TextArea: 'string',
  HiddenInput: 'string',
  MultiTextInput: 'string[]',
};

/**
 * Extract form fields from a component tree.
 *
 * @param root - The root ComponentNode
 * @returns ExtractedFormSchema with all form fields found
 */
export function extractFormSchema(root: ComponentNode): ExtractedFormSchema {
  const fields: FormField[] = [];

  function extractFromNode(node: ComponentNode, insideLoop: boolean): void {
    // Check if this is a form component
    let fieldType = FORM_COMPONENTS[node.component];

    // Special handling for Checkbox: if it has a value prop, it returns that string value
    if (node.component === 'Checkbox') {
      const valueProp = node.props.value;
      fieldType = valueProp ? 'string' : 'boolean';
    }

    if (fieldType) {
      const nameProp = node.props.name;
      if (nameProp?.type === 'literal' && typeof nameProp.value === 'string') {
        const name = nameProp.value;

        // Determine final type - arrays if inside loop or already array type
        let finalType = fieldType;
        if (insideLoop && !fieldType.endsWith('[]')) {
          finalType = `${fieldType}[]` as FormFieldType;
        }

        fields.push({
          name,
          type: finalType,
          insideLoop,
        });
      }
    }

    // Check if this is a loop component
    const isLoopComponent =
      node.component === 'List' || node.component === 'Each';

    // Recurse into children
    for (const child of node.children) {
      extractFromNode(child, insideLoop || isLoopComponent);
    }
  }

  extractFromNode(root, false);
  return { fields };
}

/**
 * Convert extracted fields to a nested object shape.
 * Handles dot notation like "user.email" -> { user: { email: ... } }
 */
export function fieldsToShape(
  fields: FormField[]
): Record<string, FormFieldType | Record<string, unknown>> {
  const shape: Record<string, unknown> = {};

  for (const field of fields) {
    const parts = field.name.split('.');
    let current = shape;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    current[lastPart] = field.type;
  }

  return shape as Record<string, FormFieldType | Record<string, unknown>>;
}

/**
 * Check if a Zod schema expects an array type.
 */
function isZodArray(schema: ZodType<unknown, ZodTypeDef, unknown>): boolean {
  if (schema instanceof z.ZodArray) {
    return true;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isZodArray(schema.unwrap());
  }
  return false;
}

/**
 * Check if a Zod schema expects a string type.
 */
function isZodString(schema: ZodType<unknown, ZodTypeDef, unknown>): boolean {
  if (schema instanceof z.ZodString) {
    return true;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isZodString(schema.unwrap());
  }
  return false;
}

/**
 * Check if a Zod schema expects a number type.
 */
function isZodNumber(schema: ZodType<unknown, ZodTypeDef, unknown>): boolean {
  if (schema instanceof z.ZodNumber) {
    return true;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isZodNumber(schema.unwrap());
  }
  return false;
}

/**
 * Check if a Zod schema expects a boolean type.
 */
function isZodBoolean(schema: ZodType<unknown, ZodTypeDef, unknown>): boolean {
  if (schema instanceof z.ZodBoolean) {
    return true;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isZodBoolean(schema.unwrap());
  }
  return false;
}

/**
 * Check if a field type matches a Zod schema.
 */
function fieldTypeMatchesSchema(
  fieldType: FormFieldType,
  zodSchema: ZodType<unknown, ZodTypeDef, unknown>
): boolean {
  // Handle array types
  if (fieldType === 'string[]' || fieldType === 'number[]') {
    if (!isZodArray(zodSchema)) {
      return false;
    }
    // Get the element schema
    let elementSchema = zodSchema;
    if (
      elementSchema instanceof z.ZodOptional ||
      elementSchema instanceof z.ZodNullable
    ) {
      elementSchema = elementSchema.unwrap();
    }
    if (elementSchema instanceof z.ZodArray) {
      const innerType = elementSchema.element;
      if (fieldType === 'string[]') {
        return isZodString(innerType);
      }
      if (fieldType === 'number[]') {
        return isZodNumber(innerType);
      }
    }
    return false;
  }

  // Handle primitive types
  switch (fieldType) {
    case 'string':
      return isZodString(zodSchema);
    case 'number':
      return isZodNumber(zodSchema);
    case 'boolean':
      return isZodBoolean(zodSchema);
    default:
      return false;
  }
}

/**
 * Validate an extracted schema against an expected Zod schema.
 *
 * @param extracted - The ExtractedFormSchema from the template
 * @param zodSchema - The expected Zod schema (must be ZodObject)
 * @returns Array of validation errors
 */
export function validateAgainstZod(
  extracted: ExtractedFormSchema,
  zodSchema: ZodType<unknown, ZodTypeDef, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check that zodSchema is an object schema
  if (!(zodSchema instanceof z.ZodObject)) {
    errors.push({
      type: 'form-schema-mismatch',
      message: 'Expected schema must be a ZodObject',
    });
    return errors;
  }

  const expectedShape = zodSchema.shape as Record<
    string,
    ZodType<unknown, ZodTypeDef, unknown>
  >;
  const extractedFieldNames = new Set(extracted.fields.map((f) => f.name));

  // Check for missing required fields
  for (const [fieldName, fieldSchema] of Object.entries(expectedShape)) {
    const isOptional =
      fieldSchema instanceof z.ZodOptional ||
      fieldSchema instanceof z.ZodNullable;

    if (!isOptional && !extractedFieldNames.has(fieldName)) {
      errors.push({
        type: 'form-schema-mismatch',
        message: `Missing required form field: "${fieldName}"`,
        path: fieldName,
      });
    }
  }

  // Check type compatibility for extracted fields
  for (const field of extracted.fields) {
    const expectedFieldSchema = expectedShape[field.name];

    if (!expectedFieldSchema) {
      // Extra field that's not in schema - could be a warning but we allow it
      continue;
    }

    if (!fieldTypeMatchesSchema(field.type, expectedFieldSchema)) {
      errors.push({
        type: 'form-schema-mismatch',
        message: `Field "${field.name}" has type "${field.type}" but expected schema requires different type`,
        path: field.name,
      });
    }
  }

  return errors;
}
