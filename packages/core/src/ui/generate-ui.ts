import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { ObjectGenerator } from '../clients/types.js';
import type { UIComponent, Placement, FormSchema } from './types.js';
import { createValidateFormTool } from './validate-form.js';

/**
 * Result of generateUI - contains all component placements from the agent loop.
 */
export interface GenerateUIResult {
  placements: Placement[];
  rootId: string | undefined;
  text?: string;
  usage: { totalTokens: number };
}

/**
 * Create tools for UI generation, including component tools and optional ValidateForm.
 * Uses a shared placements array so ValidateForm can inspect current state.
 */
function createUITools(
  components: Record<string, UIComponent<unknown>>,
  schema: FormSchema | undefined,
  data: Record<string, unknown>
) {
  // Shared state - placements accumulate as tools are called
  const placements: Placement[] = [];

  // Create component tools that push to shared placements
  const componentTools = Object.fromEntries(
    Object.entries(components).map(([name, comp]) => {
      // Extend the component's parameters to include parentId
      const extendedParameters = comp.tool.parameters.and(
        z.object({
          parentId: z.string().optional().describe('ID of the parent component to place this inside'),
        })
      );

      return [
        name,
        {
          description: comp.tool.description,
          inputSchema: extendedParameters,
          execute: (props: Record<string, unknown>): { id: string; component: string } => {
            // Extract parentId from props, rest goes to the component
            const { parentId, ...componentProps } = props;
            const placement: Placement = {
              id: uuidv4(),
              component: name,
              props: componentProps,
              parentId: (parentId as string) ?? null,
            };
            placements.push(placement);
            return { id: placement.id, component: name };
          },
        },
      ];
    })
  );

  // Add ValidateForm tool that checks schema and data bindings
  const validateFormTool = createValidateFormTool(placements, schema, data);

  return {
    tools: { ...componentTools, ValidateForm: validateFormTool },
    placements,
  };
}

/**
 * Build the system prompt for UI generation.
 */
function buildSystemPrompt(
  components: Record<string, UIComponent<unknown>>,
  hasSchema: boolean
): string {
  const componentList = Object.entries(components)
    .map(([name, comp]) => `- ${name}: ${comp.tool.description.split('\n')[0]}`)
    .join('\n');

  const basePrompt = `You are a UI generator. Build pages by calling component tools.

## Available Components
${componentList}

## Building the UI
- Call component tools to place components on the page
- Each tool returns an { id, component } object
- Use the returned id as parentId to nest components inside containers
- Root components should have no parentId (or parentId: null)

## Data Bindings
- Use {{path}} syntax to bind props to data values
- Example: {{user.name}} binds to the "name" property of "user" in the data
- Inside loops (List component), use the loop variable: {{item.field}}

## Tree Structure
1. First, place a container component (Form, Container, etc.) - this becomes the root
2. Then place child components with parentId set to the root's id
3. Continue nesting as needed`;

  const schemaPrompt = hasSchema
    ? `

## Validation
After placing form fields, call ValidateForm to verify:
1. All required schema fields have corresponding form inputs
2. All data bindings reference valid paths in the data`
    : '';

  return basePrompt + schemaPrompt;
}

/**
 * Generate a UI page using an LLM agent loop with component tools.
 *
 * The agent receives the user's prompt and can call component tools to build
 * a page structure. Each tool call records a component placement with parent
 * references to form a tree.
 *
 * @example
 * ```typescript
 * const result = await generateUI({
 *   client,
 *   prompt: 'Create a form to collect user name and email',
 *   components: defaultComponents,
 *   schema: z.object({ name: z.string(), email: z.string() }),
 *   data: { user: { name: 'John' } },
 * });
 *
 * // result.placements contains the component tree as a flat array
 * // result.rootId is the ID of the root component
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

  const { tools, placements } = createUITools(components, schema, data);

  const systemPrompt = params.system ?? buildSystemPrompt(components, !!schema);

  const result = await client.streamText({
    system: systemPrompt,
    prompt,
    tools,
    maxSteps,
  });

  // Find the root placement (no parent)
  const rootId = placements.find(p => p.parentId === null)?.id;

  return {
    placements,
    rootId,
    text: result.text,
    usage: result.usage,
  };
}
