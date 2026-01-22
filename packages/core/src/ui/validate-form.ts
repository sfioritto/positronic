import { z } from 'zod';
import type {
  Placement,
  DataType,
  ValidationError,
  ValidationResult,
  ExtractedFormField,
  ExtractedFormSchema,
} from './types.js';
import { inferDataType } from './types.js';
import type { FormSchema } from './types.js';

// ============================================
// BINDING UTILITIES
// ============================================

/**
 * Check if a value is a binding expression like "{{path}}".
 */
export function isBinding(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}');
}

/**
 * Extract the path from a binding expression.
 * "{{email.subject}}" -> "email.subject"
 */
export function extractBindingPath(binding: string): string {
  return binding.slice(2, -2).trim();
}

// ============================================
// DATA BINDING VALIDATION
// ============================================

/**
 * Components that create loop contexts.
 * Children of these components can reference the loop variable.
 */
const LOOP_COMPONENTS: Record<string, { itemsProp: string; asProp: string; defaultAs: string }> = {
  List: { itemsProp: 'items', asProp: 'as', defaultAs: 'item' },
};

/**
 * Resolve a path like "email.subject" against a DataType.
 * Returns the type at that path, or null if invalid.
 */
function resolvePathType(
  path: string,
  rootType: DataType,
  loopContext: Map<string, DataType>
): DataType | null {
  const parts = path.split('.');

  // Check if the first part is a loop variable
  const loopVar = loopContext.get(parts[0]);
  if (loopVar) {
    if (parts.length === 1) {
      return loopVar;
    }
    return resolvePathInType(parts.slice(1), loopVar);
  }

  return resolvePathInType(parts, rootType);
}

function resolvePathInType(parts: string[], type: DataType): DataType | null {
  let current = type;

  for (const part of parts) {
    if (current.kind === 'object') {
      const prop = current.properties[part];
      if (!prop) {
        return null;
      }
      current = prop;
    } else if (current.kind === 'array') {
      // Accessing array by index
      if (/^\d+$/.test(part)) {
        current = current.elementType;
      } else {
        // Trying to access a property on an array - invalid
        return null;
      }
    } else {
      // Trying to access a property on a primitive
      return null;
    }
  }

  return current;
}

/**
 * Get the loop context for a placement by walking up the parent chain.
 */
function getLoopContext(
  placement: Placement,
  placements: Placement[],
  dataType: DataType
): Map<string, DataType> {
  const context = new Map<string, DataType>();

  let current: Placement | undefined = placement;
  while (current && current.parentId) {
    const parent = placements.find(p => p.id === current!.parentId);
    if (!parent) break;

    const loopConfig = LOOP_COMPONENTS[parent.component];
    if (loopConfig) {
      const itemsProp = parent.props[loopConfig.itemsProp];
      const asProp = parent.props[loopConfig.asProp];

      if (isBinding(itemsProp)) {
        const itemsPath = extractBindingPath(itemsProp);
        const itemsType = resolvePathType(itemsPath, dataType, context);

        if (itemsType && itemsType.kind === 'array') {
          const loopVarName =
            typeof asProp === 'string' ? asProp : loopConfig.defaultAs;
          context.set(loopVarName, itemsType.elementType);
        }
      }
    }

    current = parent;
  }

  return context;
}

/**
 * Check if a placement is inside a loop component.
 */
function isInsideLoop(placement: Placement, placements: Placement[]): boolean {
  let current: Placement | undefined = placement;
  while (current && current.parentId) {
    const parent = placements.find(p => p.id === current!.parentId);
    if (!parent) break;

    if (LOOP_COMPONENTS[parent.component]) {
      return true;
    }

    current = parent;
  }
  return false;
}

/**
 * Validate all data bindings in placements against the provided data type.
 */
export function validateDataBindings(
  placements: Placement[],
  data: Record<string, unknown>
): ValidationResult {
  const dataType = inferDataType(data);
  const errors: ValidationError[] = [];

  for (const placement of placements) {
    const loopContext = getLoopContext(placement, placements, dataType);

    for (const [propName, propValue] of Object.entries(placement.props)) {
      if (isBinding(propValue)) {
        const path = extractBindingPath(propValue);
        const resolved = resolvePathType(path, dataType, loopContext);

        if (resolved === null) {
          errors.push({
            type: 'invalid-binding',
            message: `Invalid binding "{{${path}}}" - path does not exist in data`,
            path: `${placement.component}.${propName}`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================
// FORM SCHEMA EXTRACTION
// ============================================

/**
 * Components that contribute form fields.
 * Maps component name -> how to extract field info.
 */
const FORM_COMPONENTS: Record<string, { nameProp: string; fieldType: ExtractedFormField['type'] }> = {
  Input: { nameProp: 'name', fieldType: 'string' },
  TextArea: { nameProp: 'name', fieldType: 'string' },
  Checkbox: { nameProp: 'name', fieldType: 'boolean' }, // Note: overridden to 'string' if value prop is set
  Select: { nameProp: 'name', fieldType: 'string' },
  MultiTextInput: { nameProp: 'name', fieldType: 'string[]' },
  HiddenInput: { nameProp: 'name', fieldType: 'string' },
};

/**
 * Extract form schema from placements.
 * Finds all form input components and extracts their field info.
 */
export function extractFormSchema(placements: Placement[]): ExtractedFormSchema {
  const fields: ExtractedFormField[] = [];

  for (const placement of placements) {
    const formComponent = FORM_COMPONENTS[placement.component];

    if (formComponent) {
      const nameProp = placement.props[formComponent.nameProp];

      if (typeof nameProp === 'string') {
        let fieldType = formComponent.fieldType;

        // Special handling for Checkbox: if it has a value prop, it returns that string value
        if (placement.component === 'Checkbox' && placement.props.value !== undefined) {
          fieldType = 'string';
        }

        const insideLoop = isInsideLoop(placement, placements);

        // If inside a loop and it's a single value type, it becomes an array
        if (insideLoop && !fieldType.endsWith('[]')) {
          fieldType = `${fieldType}[]` as ExtractedFormField['type'];
        }

        // Check if we already have this field (e.g., multiple checkboxes with same name)
        const existing = fields.find(f => f.name === nameProp);
        if (existing) {
          // Multiple fields with same name = array
          if (!existing.type.endsWith('[]')) {
            existing.type = `${existing.type}[]` as ExtractedFormField['type'];
          }
        } else {
          fields.push({
            name: nameProp,
            type: fieldType,
            insideLoop,
          });
        }
      }
    }
  }

  return { fields };
}

/**
 * Validate extracted form schema against a Zod schema.
 */
export function validateAgainstZod(
  extracted: ExtractedFormSchema,
  zodSchema: FormSchema
): ValidationResult {
  const errors: ValidationError[] = [];

  // Get the shape from the Zod schema
  const shape = zodSchema.shape;

  // Check each schema field has a matching form field
  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const isOptional = fieldSchema instanceof z.ZodOptional;
    const extractedField = extracted.fields.find(f => f.name === fieldName);

    if (!isOptional && !extractedField) {
      errors.push({
        type: 'form-schema-mismatch',
        message: `Missing required field: ${fieldName}`,
        path: fieldName,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create the ValidateForm tool for the UI generation agent.
 * Validates both form schema and data bindings.
 */
export function createValidateFormTool(
  placements: Placement[],
  schema: FormSchema | undefined,
  data: Record<string, unknown>
) {
  return {
    description: `Validate the current form structure. Checks that:
1. Form fields will produce data matching the expected schema
2. All data bindings (like {{email.subject}}) reference valid paths in the provided data
Call this after building your form to verify it's correct.`,
    inputSchema: z.object({}),
    execute: (): { valid: boolean; errors: Array<{ type: string; message: string }>; extractedFields: Array<{ name: string; type: string }> } => {
      const errors: ValidationError[] = [];

      // 1. Extract form schema from placements
      const extracted = extractFormSchema(placements);

      // 2. Validate against expected Zod schema (if provided)
      if (schema) {
        const schemaResult = validateAgainstZod(extracted, schema);
        errors.push(...schemaResult.errors);
      }

      // 3. Validate all data bindings
      const bindingResult = validateDataBindings(placements, data);
      errors.push(...bindingResult.errors);

      return {
        valid: errors.length === 0,
        errors: errors.map(e => ({ type: e.type, message: e.message })),
        extractedFields: extracted.fields.map(f => ({ name: f.name, type: f.type })),
      };
    },
  };
}
