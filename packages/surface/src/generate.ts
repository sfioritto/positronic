import type { ObjectGenerator, JsonValue, StreamTool } from '@positronic/core';
import type { SandboxInstance } from './sandbox.js';
import { buildHtml } from './sandbox.js';
import { generateFakeData } from './lib/generate-fake-data.js';
import { writeComponentTool } from './tools/write-component.js';

import { previewTool } from './tools/preview.js';
import { submitTool } from './tools/submit.js';
import { validateFormTool } from './tools/validate-form.js';

interface GenerateDebugLog {
  fakeDataConversation: JsonValue[];
  componentConversation: JsonValue[];
  fakeData: Record<string, unknown>;
  totalDurationMs: number;
}

export interface GenerateResult {
  html: string;
  log?: GenerateDebugLog;
  screenshots?: Uint8Array[];
}

/**
 * Generate a self-contained HTML page using an LLM + sandbox loop.
 *
 * The LLM writes TSX components, type-checks them, previews screenshots,
 * validates forms, and submits when satisfied. Returns the final HTML.
 */
export async function generate(params: {
  client: ObjectGenerator;
  sandbox: SandboxInstance;
  systemPrompt: string;
  accountId: string;
  apiToken: string;
  prompt: string;
  inputSchema: string;
  outputSchema?: string;
  debug?: boolean;
}): Promise<GenerateResult> {
  const {
    client,
    sandbox,
    systemPrompt,
    accountId,
    apiToken,
    prompt,
    inputSchema,
    outputSchema,
    debug,
  } = params;

  const startTime = Date.now();
  const screenshots: Uint8Array[] = [];

  // Step 1: Generate fake data using an LLM agent loop with type-checking
  const { fakeData, responseMessages: fakeDataMessages } =
    await generateFakeData(client, sandbox, inputSchema);

  // Step 2: Define tools
  const validator = outputSchema
    ? validateFormTool(sandbox, outputSchema, fakeData)
    : undefined;

  const tools: Record<string, StreamTool> = {
    write_component: writeComponentTool(sandbox, inputSchema, outputSchema),
    preview: previewTool(sandbox, fakeData, accountId, apiToken, {
      debug,
      screenshots,
    }),
    submit: submitTool(validator),
  };

  if (validator) {
    tools.validate_form = validator;
  }

  // Step 3: Build the user prompt with schema context
  const userPrompt = `${prompt}

IMPORTANT: Import all components from '@surface/components'. Do NOT use '@/components/ui/...' paths.

The component receives a \`data\` prop with this TypeScript interface:
\`\`\`typescript
${inputSchema}
\`\`\`
${
  outputSchema
    ? `
The component must include a form that submits data matching this schema:
\`\`\`typescript
${outputSchema}
\`\`\`

After writing the component, use validate_form to verify the form fields match the schema.
`
    : ''
}
Instructions:
1. Write the component using write_component — it will be type-checked automatically
2. Fix any type errors and call write_component again
3. Preview it to see how it looks
4. Iterate until satisfied
5. Call submit when done`;

  // Step 4: Run the generation loop
  const componentResult = await client.streamText({
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 20,
    toolChoice: 'auto',
  });

  // Step 5: Build final HTML
  const htmlResult = await buildHtml(sandbox, fakeData);
  if (!htmlResult.success) {
    throw new Error(`Failed to build final HTML: ${htmlResult.errors}`);
  }

  const result: GenerateResult = { html: htmlResult.html! };

  if (debug) {
    result.screenshots = screenshots;
    result.log = {
      fakeDataConversation: truncateImages(fakeDataMessages),
      componentConversation: truncateImages(componentResult.responseMessages),
      fakeData,
      totalDurationMs: Date.now() - startTime,
    };
  }

  return result;
}

/**
 * Walk a responseMessages array and replace base64 image data with a placeholder.
 * This keeps the log readable while preserving conversation structure.
 */
function truncateImages(messages: JsonValue[]): JsonValue[] {
  return JSON.parse(JSON.stringify(messages), (key, value) => {
    if (key === 'data' && typeof value === 'string' && value.length > 1000) {
      return `[truncated ${Math.round(
        value.length / 1024
      )}kb — see screenshots array]`;
    }
    return value;
  });
}
