import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { ObjectGenerator } from '../clients/types.js';
import type { UIComponent } from './types.js';
import type { FormSchema } from './types.js';

/**
 * Result of a component tool call during UI generation.
 */
export interface ComponentPlacement {
  id: string;
  component: string;
  props: unknown;
}

/**
 * Result of generateUI - contains all component placements from the agent loop.
 */
export interface GenerateUIResult {
  placements: ComponentPlacement[];
  text?: string;
  usage: { totalTokens: number };
}

/**
 * Result of ValidateForm tool execution.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Extract form field names from placements.
 * Form fields are components with a `name` prop (Input, TextArea, Checkbox, Select, etc.)
 */
function extractFormFields(placements: ComponentPlacement[]): Set<string> {
  const fields = new Set<string>();
  for (const placement of placements) {
    const props = placement.props as Record<string, unknown>;
    if (props && typeof props.name === 'string') {
      fields.add(props.name);
    }
  }
  return fields;
}

/**
 * Validate placements against a form schema.
 * Checks that all required schema fields have corresponding form inputs.
 */
function validateAgainstSchema(placements: ComponentPlacement[], schema: FormSchema): ValidationResult {
  const formFields = extractFormFields(placements);
  const errors: string[] = [];

  // Get schema shape and check each field
  const shape = schema.shape;
  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const isOptional = fieldSchema instanceof z.ZodOptional;

    if (!isOptional && !formFields.has(fieldName)) {
      errors.push(`Missing required field: ${fieldName}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create tools for UI generation, including component tools and optional ValidateForm.
 * Uses a shared placements array so ValidateForm can inspect current state.
 */
function createUITools(
  components: Record<string, UIComponent<any>>,
  schema?: FormSchema
) {
  // Shared state - placements accumulate as tools are called
  const placements: ComponentPlacement[] = [];

  // Create component tools that push to shared placements
  const componentTools = Object.fromEntries(
    Object.entries(components).map(([name, comp]) => [
      name,
      {
        description: comp.tool.description,
        inputSchema: comp.tool.parameters,
        execute: (props: unknown): ComponentPlacement => {
          const placement = {
            id: uuidv4(),
            component: name,
            props,
          };
          placements.push(placement);
          return placement;
        },
      },
    ])
  );

  // If no schema, just return component tools
  if (!schema) {
    return { tools: componentTools, placements };
  }

  // Add ValidateForm tool that checks against schema
  const validateFormTool = {
    description: `Check if the current form satisfies the required schema. Call this after placing form fields to verify all required fields are present. Returns { valid: true } if OK, or { valid: false, errors: [...] } with missing fields.`,
    inputSchema: z.object({}),
    execute: (): ValidationResult => validateAgainstSchema(placements, schema),
  };

  return {
    tools: { ...componentTools, ValidateForm: validateFormTool },
    placements,
  };
}

/**
 * Generate a UI page using an LLM agent loop with component tools.
 *
 * The agent receives the user's prompt and can call component tools to build
 * a page structure. Each tool call records a component placement.
 *
 * When a schema is provided, a ValidateForm tool is added that the agent can
 * call to check if the form satisfies the schema requirements.
 *
 * @example
 * ```typescript
 * const result = await generateUI({
 *   client,
 *   prompt: 'Create a form to collect user name and email',
 *   components: defaultComponents,
 *   schema: z.object({ name: z.string(), email: z.string() }),
 * });
 *
 * // result.placements contains the component tree
 * ```
 */
export async function generateUI(params: {
  client: ObjectGenerator;
  prompt: string;
  components: Record<string, UIComponent<any>>;
  schema?: FormSchema;
  system?: string;
  maxSteps?: number;
}): Promise<GenerateUIResult> {
  const { client, prompt, components, schema, maxSteps = 10 } = params;

  const { tools, placements } = createUITools(components, schema);

  const baseSystemPrompt = `You are a UI generator. Build pages by calling component tools.

Available components can be used to create forms, display text, and organize layouts.
Call the appropriate component tools to build the requested UI.
Each tool call places a component on the page.`;

  const schemaSystemPrompt = schema
    ? `\n\nAfter placing form fields, call ValidateForm to verify all required fields are present.`
    : '';

  const systemPrompt = params.system ?? (baseSystemPrompt + schemaSystemPrompt);

  const result = await client.streamText({
    system: systemPrompt,
    prompt,
    tools,
    maxSteps,
  });

  return {
    placements,
    text: result.text,
    usage: result.usage,
  };
}
