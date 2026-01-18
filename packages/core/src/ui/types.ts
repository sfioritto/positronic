import type { ComponentType } from 'react';
import { z } from 'zod';

/**
 * A UI component that can be used by the LLM to build pages.
 * Combines a React component with its tool definition for the LLM.
 */
export interface UIComponent<TProps = unknown> {
  /**
   * React component for rendering this UI element.
   */
  component: ComponentType<TProps>;

  /**
   * Tool definition for the LLM to call this component.
   */
  tool: {
    /**
     * Description of what this component does and when to use it.
     * This is shown to the LLM to help it choose appropriate components.
     */
    description: string;

    /**
     * Zod schema defining the props/parameters for this component.
     * The LLM will generate arguments matching this schema.
     */
    parameters: z.ZodSchema<TProps>;
  };
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
