import type {
  ObjectGenerator,
  JsonValue,
  StreamTool,
  StreamStepInfo,
} from '@positronic/core';
import type { ZodObject } from 'zod';
import type { SandboxInstance, RenderPage } from './sandbox.js';
import { buildBundle, makeRender } from './sandbox.js';
import { generateFakeData } from './lib/generate-fake-data.js';
import { zodToTypescript } from './lib/zod-to-typescript.js';
import type { Viewport } from './screenshot.js';
import { writeComponentTool } from './tools/write-component.js';
import { showComponentSourceTool } from './tools/show-component-source.js';
import { respondToFeedbackTool } from './tools/respond-to-feedback.js';

import { previewTool } from './tools/preview.js';
import { submitTool } from './tools/submit.js';

interface GenerateDebugLog {
  componentConversation: JsonValue[];
  data: Record<string, unknown>;
  totalDurationMs: number;
}

type PreviewScreenshots = Record<Viewport, Uint8Array>;

export interface GenerateResult {
  render: RenderPage;
  log?: GenerateDebugLog;
  /** One entry per preview call, each containing mobile/tablet/desktop JPEGs. */
  screenshots?: PreviewScreenshots[];
}

export type ProgressEvent =
  | { type: 'fake_data_done'; data: Record<string, unknown> }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'step_finish'; step: StreamStepInfo };

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
  /**
   * Pre-generated dataset to use instead of invoking generateFakeData. Must
   * already conform to inputSchema. When provided, the schema walk is
   * skipped entirely — saves the model calls the walk would fan out to.
   */
  previewData?: Record<string, unknown>;
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
    previewData: cachedPreviewData,
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
  const reviewState = { approved: false, feedbackAttempts: 0 };

  // Step 1: Generate one dataset by walking the input schema. Fans out at
  // array-of-object boundaries (each must carry `.meta({ count: N })`) and
  // one-shots any subtree that contains no annotated arrays. The resulting
  // data matches the real shape exactly, so the UI feedback loop only needs
  // to cover viewports — not data volume. Skipped when the caller hands us
  // a cached dataset (e.g. run.sh re-feeding an earlier run's fake-data.json).
  const previewData =
    cachedPreviewData ??
    ((await generateFakeData({
      client,
      schema: inputSchema,
      prompt,
    })) as Record<string, unknown>);

  await onProgress?.({ type: 'fake_data_done', data: previewData });

  // Step 2: Define tools
  const rawTools: Record<string, StreamTool> = {
    write_component: writeComponentTool(sandbox, inputSchemaTs),
    show_component_source: showComponentSourceTool(),
    respond_to_feedback: respondToFeedbackTool(
      client,
      sandbox,
      systemPrompt,
      inputSchemaTs,
      outputSchemaTs,
      reviewState
    ),
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
1. Write the initial component using write_component — it will be type-checked automatically
2. Fix any type errors and call write_component again
3. Call preview to see how it looks and get a reviewer verdict
4. If the reviewer rejects it, call respond_to_feedback with the issues — a sub-agent will revise the component for you. Do NOT rewrite the component yourself at this point.
5. Call preview again after respond_to_feedback finishes
6. Repeat 4-5 until the reviewer approves
7. Call submit — this ends the task. Do not call any tool after submit returns success.`;

  // Step 4: Run the generation loop
  const componentResult = await client.streamText({
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 20,
    toolChoice: 'required',
    onStepFinish: onProgress
      ? (step) => onProgress({ type: 'step_finish', step })
      : undefined,
    stopWhen: ({ steps }) => {
      const last = steps[steps.length - 1] as
        | { toolResults?: Array<{ toolName: string; output: unknown }> }
        | undefined;
      return (
        last?.toolResults?.some(
          (r) =>
            r.toolName === 'submit' &&
            (r.output as { status?: string } | undefined)?.status === 'success'
        ) ?? false
      );
    },
  });

  // Step 5: The stream must have reached a successful submit before we try
  // to bundle. Otherwise the sandbox holds whatever garbage the model last
  // wrote (or never wrote), and buildBundle would surface a misleading
  // esbuild error instead of the real cause — the loop terminated early.
  // reviewState.approved is set true by submit (natural success) or by the
  // budget cap in preview (graceful force-submit); both are acceptable.
  if (!reviewState.approved) {
    throw new Error(
      'Generation loop exited without a successful submit. The model gave up before producing a reviewable component — check the conversation log for the last tool error. Common causes: type errors it could not resolve, repeated rejection from the reviewer, or the model emitting finish=stop after two consecutive tool errors.'
    );
  }

  // Build the bundle once; return a render closure so the caller can
  // interpolate real data and form config without seeing it here.
  const bundleResult = await buildBundle(sandbox);
  if (!bundleResult.success) {
    throw new Error(`Failed to build final bundle: ${bundleResult.errors}`);
  }

  const result: GenerateResult = { render: makeRender(bundleResult.bundle!) };

  if (debug) {
    result.screenshots = screenshots;
    result.log = {
      componentConversation: truncateImages(componentResult.responseMessages),
      data: previewData,
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
