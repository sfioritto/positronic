import type { ObjectGenerator, JsonValue, StreamTool } from '@positronic/core';
import type { ZodObject } from 'zod';
import type { SandboxInstance, RenderPage } from './sandbox.js';
import { buildBundle, makeRender } from './sandbox.js';
import {
  generateFakeDatasets,
  type FakeDatasets,
} from './lib/generate-fake-datasets.js';
import { zodToTypescript } from './lib/zod-to-typescript.js';
import type { Viewport } from './screenshot.js';
import { writeComponentTool } from './tools/write-component.js';
import { showComponentSourceTool } from './tools/show-component-source.js';

import { previewTool } from './tools/preview.js';
import { submitTool } from './tools/submit.js';

interface GenerateDebugLog {
  fakeDataConversation: JsonValue[];
  componentConversation: JsonValue[];
  datasets: FakeDatasets;
  totalDurationMs: number;
}

export type PreviewScreenshots = Record<Viewport, Uint8Array>;

export interface GenerateResult {
  render: RenderPage;
  log?: GenerateDebugLog;
  /** One entry per preview call, each containing mobile/tablet/desktop PNGs. */
  screenshots?: PreviewScreenshots[];
}

export type ProgressEvent =
  | { type: 'fake_data_done'; datasets: FakeDatasets }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_result'; tool: string; result: unknown };

/**
 * Generate a self-contained HTML page using an LLM + sandbox loop.
 *
 * The LLM writes TSX components, type-checks them, previews screenshots,
 * validates forms, and submits when satisfied. Returns the final HTML.
 */
export async function generate(params: {
  client: ObjectGenerator;
  /** Reviewer LLM for preview quality gate. Defaults to `client`. */
  reviewClient?: ObjectGenerator;
  sandbox: SandboxInstance;
  systemPrompt: string;
  accountId: string;
  apiToken: string;
  prompt: string;
  inputSchema: ZodObject<any>;
  outputSchema?: ZodObject<any>;
  debug?: boolean;
  onProgress?: (event: ProgressEvent) => void | Promise<void>;
}): Promise<GenerateResult> {
  const {
    client,
    reviewClient,
    sandbox,
    systemPrompt,
    accountId,
    apiToken,
    prompt,
    inputSchema,
    outputSchema,
    debug,
    onProgress,
  } = params;

  // Convert Zod schemas to TypeScript strings at the boundary
  const inputSchemaTs = zodToTypescript(inputSchema, 'Data');
  const outputSchemaTs = outputSchema
    ? zodToTypescript(outputSchema, 'FormData')
    : undefined;
  const outputFieldNames = outputSchema
    ? Object.keys(outputSchema.shape)
    : undefined;

  const startTime = Date.now();
  const screenshots: PreviewScreenshots[] = [];
  const reviewState = { approved: false };

  // Step 1: Generate four fake-data variants (empty / sparse / typical / large)
  // in sequence, each type-checked against the input schema. Preview uses
  // `typical` for the generator's feedback loop; other variants are kept for
  // future multi-data-size review passes.
  const { datasets, responseMessages: fakeDataMessages } =
    await generateFakeDatasets(client, sandbox, inputSchemaTs);

  await onProgress?.({ type: 'fake_data_done', datasets });

  const previewData = datasets.typical;

  // Step 2: Define tools
  const rawTools: Record<string, StreamTool> = {
    write_component: writeComponentTool(sandbox, inputSchemaTs),
    show_component_source: showComponentSourceTool(),
    preview: previewTool(
      sandbox,
      previewData,
      accountId,
      apiToken,
      {
        client: reviewClient ?? client,
        userPrompt: prompt,
        inputSchemaTs,
        outputSchemaTs,
      },
      reviewState,
      { debug, screenshots }
    ),
    submit: submitTool(sandbox, outputFieldNames, previewData, reviewState),
  };

  // Wrap tools to emit progress events (tools without execute are pass-through —
  // the Vercel AI SDK uses missing execute as a loop termination signal)
  const tools: Record<string, StreamTool> = {};
  for (const [name, tool] of Object.entries(rawTools)) {
    if (!tool.execute) {
      tools[name] = tool;
      continue;
    }
    const original = tool.execute;
    tools[name] = {
      ...tool,
      async execute(input: unknown) {
        await onProgress?.({ type: 'tool_start', tool: name });
        const result = await original(input);
        await onProgress?.({ type: 'tool_result', tool: name, result });
        return result;
      },
    };
  }

  // Step 3: Build the user prompt with schema context
  const userPrompt = `${prompt}

IMPORTANT: Import all components from '@surface/components'. Do NOT use '@/components/ui/...' paths.

The component receives a \`data\` prop with this TypeScript interface:
\`\`\`typescript
${inputSchemaTs}
\`\`\`
${
  outputSchemaTs
    ? `
The component must include a form that submits data matching this schema:
\`\`\`typescript
${outputSchemaTs}
\`\`\`
`
    : ''
}
Instructions:
1. Write the component using write_component — it will be type-checked automatically
2. Fix any type errors and call write_component again
3. Preview it to see how it looks
4. Iterate until satisfied
5. Call submit when done — it will validate form fields against the schema if applicable`;

  // Step 4: Run the generation loop
  const componentResult = await client.streamText({
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 20,
    toolChoice: 'auto',
  });

  // Step 5: Build the bundle once; return a render closure so the caller
  // can interpolate real data and form config without seeing it here.
  const bundleResult = await buildBundle(sandbox);
  if (!bundleResult.success) {
    throw new Error(`Failed to build final bundle: ${bundleResult.errors}`);
  }

  const result: GenerateResult = { render: makeRender(bundleResult.bundle!) };

  if (debug) {
    result.screenshots = screenshots;
    result.log = {
      fakeDataConversation: truncateImages(fakeDataMessages),
      componentConversation: truncateImages(componentResult.responseMessages),
      datasets,
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
