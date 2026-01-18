import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator } from '../clients/types.js';
import type { UIComponent } from './types.js';

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
 * Convert UIComponents to tools for the LLM.
 * Each tool returns a ComponentPlacement when called.
 */
function componentsToTools(components: Record<string, UIComponent>) {
  return Object.fromEntries(
    Object.entries(components).map(([name, comp]) => [
      name,
      {
        description: comp.tool.description,
        inputSchema: comp.tool.parameters,
        execute: (props: unknown): ComponentPlacement => ({
          id: uuidv4(),
          component: name,
          props,
        }),
      },
    ])
  );
}

/**
 * Generate a UI page using an LLM agent loop with component tools.
 *
 * The agent receives the user's prompt and can call component tools to build
 * a page structure. Each tool call records a component placement.
 *
 * @example
 * ```typescript
 * const result = await generateUI({
 *   client,
 *   prompt: 'Create a form to collect user name and email',
 *   components: defaultComponents,
 * });
 *
 * // result.placements contains the component tree
 * ```
 */
export async function generateUI(params: {
  client: ObjectGenerator;
  prompt: string;
  components: Record<string, UIComponent>;
  system?: string;
  maxSteps?: number;
}): Promise<GenerateUIResult> {
  const { client, prompt, components, maxSteps = 10 } = params;

  const tools = componentsToTools(components);

  const systemPrompt = params.system ?? `You are a UI generator. Build pages by calling component tools.

Available components can be used to create forms, display text, and organize layouts.
Call the appropriate component tools to build the requested UI.
Each tool call places a component on the page.`;

  const result = await client.streamText({
    system: systemPrompt,
    prompt,
    tools,
    maxSteps,
  });

  // Extract placements from tool results
  const placements = result.toolCalls
    .map((tc) => tc.result as ComponentPlacement)
    .filter((p): p is ComponentPlacement => p != null && typeof p === 'object' && 'id' in p);

  return {
    placements,
    text: result.text,
    usage: result.usage,
  };
}
