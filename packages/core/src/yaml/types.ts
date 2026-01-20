/**
 * Types for the YAML-based UI generation DSL.
 *
 * Templates are written in YAML and parsed into an AST of ComponentNodes.
 * Props can be literal values or binding expressions ({{path}}) that are
 * resolved at render time against provided data.
 */

/**
 * A binding expression like {{emails}} or {{email.subject}}
 * that references data to be resolved at render time.
 */
export interface BindingExpression {
  type: 'binding';
  path: string; // e.g., "emails" or "email.subject"
}

/**
 * A literal value that doesn't need resolution.
 */
export interface LiteralValue {
  type: 'literal';
  value: string | number | boolean | null;
}

/**
 * A prop value can be either a binding or a literal.
 */
export type PropValue = BindingExpression | LiteralValue;

/**
 * A component node in the AST.
 */
export interface ComponentNode {
  component: string; // e.g., "Form", "List", "Checkbox"
  props: Record<string, PropValue>;
  children: ComponentNode[];
}

/**
 * The root of a parsed template.
 */
export interface Template {
  root: ComponentNode;
}

/**
 * Form field types that the schema extractor recognizes.
 */
export type FormFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]';

/**
 * Extracted form field info.
 */
export interface FormField {
  name: string;
  type: FormFieldType;
  insideLoop: boolean; // If field is inside a loop
}

/**
 * The extracted form schema from a template.
 */
export interface ExtractedFormSchema {
  fields: FormField[];
}

/**
 * Validation error types.
 */
export interface ValidationError {
  type:
    | 'form-schema-mismatch'
    | 'invalid-binding'
    | 'unknown-component'
    | 'missing-prop';
  message: string;
  path?: string;
}

/**
 * Result of validating a template.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Data type inference for validating bindings.
 */
export type DataType =
  | { kind: 'primitive'; type: 'string' | 'number' | 'boolean' | 'null' }
  | { kind: 'array'; elementType: DataType }
  | { kind: 'object'; properties: Record<string, DataType> }
  | { kind: 'unknown' };
