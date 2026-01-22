import type { ComponentType } from 'react';
import { z } from 'zod';

// ============================================
// PLACEMENT TYPES
// ============================================

/**
 * A placed component in the UI tree.
 * Components are stored in a flat array with parentId references to form a tree.
 */
export interface Placement {
  /** Unique identifier for this placement */
  id: string;
  /** Component name, e.g., "Form", "Input", "Checkbox" */
  component: string;
  /** Props for the component, may contain binding expressions like "{{path}}" */
  props: Record<string, unknown>;
  /** Parent placement ID, null for root components */
  parentId: string | null;
}

// ============================================
// DATA TYPE INFERENCE
// ============================================

/**
 * Represents the inferred type of a data value.
 * Used for validating data bindings against the provided data.
 */
export type DataType =
  | { kind: 'primitive'; type: 'string' | 'number' | 'boolean' | 'null' }
  | { kind: 'array'; elementType: DataType }
  | { kind: 'object'; properties: Record<string, DataType> }
  | { kind: 'unknown' };

/**
 * Infer the DataType from a sample value.
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
    // Infer from first element
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

// ============================================
// VALIDATION TYPES
// ============================================

/**
 * A validation error from ValidateForm.
 */
export interface ValidationError {
  type: 'form-schema-mismatch' | 'invalid-binding' | 'unknown-component' | 'missing-prop';
  message: string;
  path?: string;
}

/**
 * Result of validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Extracted form field info.
 */
export interface ExtractedFormField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  insideLoop: boolean;
}

/**
 * The extracted form schema from placements.
 */
export interface ExtractedFormSchema {
  fields: ExtractedFormField[];
}

// ============================================
// UI COMPONENT TYPES
// ============================================

/**
 * A UI component that can be used by the LLM to build pages.
 * Combines a React component with metadata for the LLM.
 *
 * Use the schema-first approach: define props as a Zod schema,
 * then derive the TypeScript type with `z.infer<typeof schema>`.
 *
 * @example
 * ```typescript
 * const InputPropsSchema = z.object({
 *   name: z.string().describe('Form field name'),
 *   label: z.string().describe('Label displayed above input'),
 *   required: z.boolean().optional().describe('Whether field is required'),
 * });
 *
 * type InputProps = z.infer<typeof InputPropsSchema>;
 *
 * export const Input: UIComponent<InputProps> = {
 *   component: InputComponent,
 *   description: 'A single-line text input field.',
 *   propsSchema: InputPropsSchema,
 * };
 * ```
 */
export interface UIComponent<TProps = unknown> {
  /**
   * React component for rendering this UI element.
   */
  component: ComponentType<TProps>;

  /**
   * Description of what this component does and when to use it.
   * This is shown to the LLM to help it choose appropriate components.
   */
  description: string;

  /**
   * Zod schema defining the props for this component.
   * Used to generate documentation for the LLM about available props.
   * Use `.describe()` on each field to provide helpful descriptions.
   */
  propsSchema?: z.ZodObject<z.ZodRawShape>;
}

/**
 * Form-compatible primitive types that can be collected via HTML forms.
 * These types map directly to form inputs without LLM coercion.
 */
export type FormPrimitive =
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodEnum<[string, ...string[]]>;

/**
 * A form field is either a primitive or an optional/array wrapper around a primitive.
 */
export type FormField =
  | FormPrimitive
  | z.ZodOptional<FormPrimitive>
  | z.ZodArray<FormPrimitive>;

/**
 * A form schema is a Zod object where all fields are form-compatible.
 * This constraint ensures forms can be mechanically converted to JSON
 * without requiring LLM interpretation of the submitted data.
 *
 * Supported field types:
 * - z.string() → Input / TextArea
 * - z.number() → Input (type="number")
 * - z.boolean() → Checkbox
 * - z.enum([...]) → Select / radio buttons
 * - z.array(z.string()) → MultiTextInput
 * - z.array(z.enum([...])) → Multi-select / checkbox group
 * - z.optional(...) → Optional version of any above
 */
export type FormSchema = z.ZodObject<{
  [key: string]: FormField;
}>;

/**
 * Type guard to check if a schema is form-compatible at runtime.
 * Used as a backup validation when TypeScript inference isn't sufficient.
 */
export function isFormSchema(schema: z.ZodSchema): schema is FormSchema {
  if (!(schema instanceof z.ZodObject)) {
    return false;
  }

  const shape = schema.shape;
  for (const key in shape) {
    if (!isFormField(shape[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard to check if a Zod schema is a valid form field.
 */
function isFormField(schema: z.ZodSchema): schema is FormField {
  // Check for optional wrapper
  if (schema instanceof z.ZodOptional) {
    return isFormPrimitive(schema.unwrap());
  }

  // Check for array wrapper
  if (schema instanceof z.ZodArray) {
    return isFormPrimitive(schema.element);
  }

  // Check if it's a primitive directly
  return isFormPrimitive(schema);
}

/**
 * Type guard to check if a Zod schema is a form primitive.
 */
function isFormPrimitive(schema: z.ZodSchema): schema is FormPrimitive {
  return (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodEnum
  );
}

