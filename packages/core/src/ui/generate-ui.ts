import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { ObjectGenerator } from '../clients/types.js';
import type { UIComponent, Placement, FormSchema } from './types.js';
import { parseTemplate } from '../yaml/parser.js';
import { inferDataType, validateDataBindings } from '../yaml/data-validator.js';
import {
  extractFormSchema,
  validateAgainstZod,
} from '../yaml/schema-extractor.js';
import { describeDataShape } from '../yaml/type-inference.js';
import type { ComponentNode, ValidationError } from '../yaml/types.js';

/**
 * Result of generateUI - contains all component placements from the agent loop.
 */
export interface GenerateUIResult {
  placements: Placement[];
  rootId: string | undefined;
  yaml?: string;
  text?: string;
  usage: { totalTokens: number };
}

/**
 * Convert a ComponentNode tree to a flat array of Placements.
 */
function treeToPlacementsRecursive(
  node: ComponentNode,
  parentId: string | null,
  placements: Placement[]
): string {
  const id = uuidv4();

  // Convert PropValue to raw values
  const props: Record<string, unknown> = {};
  for (const [key, propValue] of Object.entries(node.props)) {
    if (propValue.type === 'binding') {
      props[key] = `{{${propValue.path}}}`;
    } else {
      props[key] = propValue.value;
    }
  }

  placements.push({
    id,
    component: node.component,
    props,
    parentId,
  });

  // Recurse into children
  for (const child of node.children) {
    treeToPlacementsRecursive(child, id, placements);
  }

  return id;
}

/**
 * Convert a ComponentNode tree to a flat Placements array.
 */
function treeToPlacements(root: ComponentNode): Placement[] {
  const placements: Placement[] = [];
  treeToPlacementsRecursive(root, null, placements);
  return placements;
}

/**
 * Create the validate_template tool for YAML validation.
 */
function createValidateTemplateTool(
  components: Record<string, UIComponent<unknown>>,
  schema: FormSchema | undefined,
  data: Record<string, unknown>
) {
  const dataType = inferDataType(data);

  return {
    description: `Validate a YAML template. Checks that:
1. The YAML is valid and can be parsed
2. All component names are valid
3. All data bindings (like {{email.subject}}) reference valid paths in the provided data
4. Form components have a Button for submission
5. The form fields will produce data matching the expected schema (if schema provided)

Call this after generating your YAML template to verify it's correct before finalizing.`,
    inputSchema: z.object({
      yaml: z.string().describe('The complete YAML template to validate'),
    }),
    execute: (
      args: unknown
    ): {
      valid: boolean;
      errors: Array<{ type: string; message: string }>;
      extractedFields?: Array<{ name: string; type: string }>;
    } => {
      const { yaml } = args as { yaml: string };
      const errors: ValidationError[] = [];

      // 1. Parse YAML
      let root: ComponentNode;
      try {
        const template = parseTemplate(yaml);
        root = template.root;
      } catch (error) {
        return {
          valid: false,
          errors: [
            {
              type: 'parse-error',
              message:
                error instanceof Error ? error.message : 'Failed to parse YAML',
            },
          ],
        };
      }

      // 2. Validate component names
      const componentNames = new Set(Object.keys(components));
      componentNames.add('List'); // Built-in loop component
      const unknownComponents = validateComponentNames(root, componentNames);
      for (const compName of unknownComponents) {
        errors.push({
          type: 'unknown-component',
          message: `Unknown component: "${compName}"`,
        });
      }

      // 3. Validate data bindings
      const bindingResult = validateDataBindings(root, dataType);
      errors.push(...bindingResult.errors);

      // 4. Validate Form components have a Button for submission
      const formButtonErrors = validateFormHasButton(root);
      errors.push(...formButtonErrors);

      // 5. Validate form schema if provided
      let extractedFields: Array<{ name: string; type: string }> | undefined;
      if (schema) {
        const extracted = extractFormSchema(root);
        extractedFields = extracted.fields.map((f) => ({
          name: f.name,
          type: f.type,
        }));

        const schemaErrors = validateAgainstZod(extracted, schema);
        errors.push(...schemaErrors);
      }

      return {
        valid: errors.length === 0,
        errors: errors.map((e) => ({ type: e.type, message: e.message })),
        extractedFields,
      };
    },
  };
}

/**
 * Recursively find all component names that aren't in the allowed set.
 */
function validateComponentNames(
  node: ComponentNode,
  allowed: Set<string>
): string[] {
  const unknown: string[] = [];

  if (!allowed.has(node.component)) {
    unknown.push(node.component);
  }

  for (const child of node.children) {
    unknown.push(...validateComponentNames(child, allowed));
  }

  return unknown;
}

/**
 * Check if a component tree contains a Button component.
 */
function hasButtonDescendant(node: ComponentNode): boolean {
  if (node.component === 'Button') {
    return true;
  }
  return node.children.some(hasButtonDescendant);
}

/**
 * Validate that all Form components have a Button for submission.
 */
function validateFormHasButton(root: ComponentNode): ValidationError[] {
  const errors: ValidationError[] = [];

  function checkNode(node: ComponentNode): void {
    if (node.component === 'Form') {
      if (!hasButtonDescendant(node)) {
        errors.push({
          type: 'form-missing-submit-button',
          message: 'Form component requires a Button for submission',
        });
      }
    }
    // Check children for nested forms
    for (const child of node.children) {
      checkNode(child);
    }
  }

  checkNode(root);
  return errors;
}

/**
 * Build the system prompt describing the YAML DSL.
 */
function buildSystemPrompt(
  components: Record<string, UIComponent<unknown>>,
  hasSchema: boolean
): string {
  const componentDocs = Object.entries(components)
    .map(([name, comp]) => {
      const desc = comp.tool.description.split('\n')[0];
      return `### ${name}\n${desc}`;
    })
    .join('\n\n');

  return `You are a UI generator that creates YAML templates for dynamic pages.

## YAML Format

Generate a YAML template with a single root component. Components are objects where the key is the component name and the value contains props and children.

\`\`\`yaml
Form:
  submitLabel: "Submit"
  children:
    - Heading:
        content: "Contact Form"
        level: "1"
    - Input:
        name: "email"
        label: "Email Address"
        type: "email"
        required: true
    - TextArea:
        name: "message"
        label: "Your Message"
\`\`\`

## Data Bindings

Use \`{{path}}\` syntax to bind props to data values:
- \`{{user.name}}\` - binds to the "name" property of "user" in the data
- \`{{items}}\` - binds to the "items" array

## List Component (Loops)

Use the List component to iterate over arrays:

\`\`\`yaml
List:
  items: "{{emails}}"
  as: "email"
  children:
    - Container:
        children:
          - Text:
              content: "{{email.subject}}"
          - Checkbox:
              name: "selectedIds"
              value: "{{email.id}}"
              label: "Select"
\`\`\`

The \`as\` prop defines the variable name for each item (defaults to "item").
Inside the List's children, you can reference \`{{email.fieldName}}\` for item properties.

## Available Components

${componentDocs}

## Important Rules

1. Generate ONLY valid YAML - no markdown code fences, no extra text
2. Use proper YAML indentation (2 spaces)
3. String values with special characters should be quoted
4. The root must be a single component (usually Form or Container)
5. Use \`children:\` array for nested components
6. Do NOT use markdown formatting in content strings - no **bold**, *italic*, or [links](url). These are React components, not markdown. URLs should be included as plain text.
${hasSchema ? '7. After generating the YAML, call validate_template to verify it matches the expected schema' : ''}`;
}

/**
 * Build the user prompt with data shape and instructions.
 */
function buildUserPrompt(
  prompt: string,
  data: Record<string, unknown>,
  schema: FormSchema | undefined
): string {
  const dataShape = describeDataShape(data);

  let userPrompt = `## Available Data
\`\`\`typescript
${dataShape}
\`\`\`

## Instructions
${prompt}`;

  if (schema) {
    const schemaFields = Object.entries(schema.shape)
      .map(([name, field]) => {
        const isOptional = field instanceof z.ZodOptional;
        const baseType = isOptional ? field.unwrap() : field;
        let typeName = 'unknown';
        if (baseType instanceof z.ZodString) typeName = 'string';
        else if (baseType instanceof z.ZodNumber) typeName = 'number';
        else if (baseType instanceof z.ZodBoolean) typeName = 'boolean';
        else if (baseType instanceof z.ZodArray) typeName = `${typeName}[]`;
        return `- ${name}: ${typeName}${isOptional ? ' (optional)' : ''}`;
      })
      .join('\n');

    userPrompt += `

## Expected Form Output
The form must collect these fields:
${schemaFields}

Call validate_template after generating your YAML to verify correctness.`;
  }

  return userPrompt;
}

/**
 * Generate a UI page using an LLM agent loop with YAML templates.
 *
 * The agent receives the user's prompt and generates a YAML template describing
 * the component tree. The template is validated and converted to placements.
 *
 * @example
 * ```typescript
 * import { components } from '@positronic/gen-ui-components';
 *
 * const result = await generateUI({
 *   client,
 *   prompt: 'Create a form to collect user name and email',
 *   components,
 *   schema: z.object({ name: z.string(), email: z.string() }),
 *   data: { user: { name: 'John' } },
 * });
 *
 * // result.placements contains the component tree as a flat array
 * // result.rootId is the ID of the root component
 * // result.yaml is the generated YAML template
 * ```
 */
export async function generateUI(params: {
  client: ObjectGenerator;
  prompt: string;
  components: Record<string, UIComponent<unknown>>;
  schema?: FormSchema;
  data?: Record<string, unknown>;
  system?: string;
  maxSteps?: number;
}): Promise<GenerateUIResult> {
  const { client, prompt, components, schema, data = {}, maxSteps = 10 } = params;

  const systemPrompt =
    params.system ?? buildSystemPrompt(components, !!schema);
  const userPrompt = buildUserPrompt(prompt, data, schema);

  // Create the validate_template tool
  const validateTool = createValidateTemplateTool(components, schema, data);

  const result = await client.streamText({
    system: systemPrompt,
    prompt: userPrompt,
    tools: {
      validate_template: validateTool,
    },
    maxSteps,
  });

  // Extract YAML from the response text
  // The LLM should output YAML directly or in a code block
  let yamlContent = result.text ?? '';

  // Strip markdown code fences if present
  const yamlMatch = yamlContent.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  if (yamlMatch) {
    yamlContent = yamlMatch[1].trim();
  } else {
    yamlContent = yamlContent.trim();
  }

  // Try to parse and convert to placements
  let placements: Placement[] = [];
  let rootId: string | undefined;

  if (yamlContent) {
    try {
      const template = parseTemplate(yamlContent);
      placements = treeToPlacements(template.root);
      rootId = placements.find((p) => p.parentId === null)?.id;
    } catch {
      // If parsing fails, return empty placements
      // The validation tool should have caught this during generation
    }
  }

  return {
    placements,
    rootId,
    yaml: yamlContent || undefined,
    text: result.text,
    usage: result.usage,
  };
}
