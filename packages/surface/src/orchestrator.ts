import { z } from 'zod';
import type {
  JsonValue,
  ObjectGenerator,
  StreamTool,
  StreamStepInfo,
} from '@positronic/core';
import type { ZodObject } from 'zod';
import type { SandboxInstance, RenderPage } from './sandbox.js';
import { buildBundle, makeRender } from './sandbox.js';
import { generateFakeData } from './lib/generate-fake-data.js';
import { zodToTypescript } from './lib/zod-to-typescript.js';
import { screenshotAllViewports, type Viewport } from './screenshot.js';
import {
  runSectionSubagent,
  type Section,
  type SubagentState,
  type SubagentProgressEvent,
} from './section-subagent.js';
import { knitSections } from './knit.js';
import {
  stripProgressImageBytes,
  truncateImages,
  uint8ToBase64,
  viewportScreenshotContent,
} from './lib/progress-sanitize.js';

type PreviewScreenshots = Record<Viewport, Uint8Array>;

interface GenerateDebugLog {
  orchestratorConversation: JsonValue[];
  subagentStates: Record<string, SubagentState>;
  sections: Section[];
  data: Record<string, unknown>;
  totalDurationMs: number;
}

export interface GenerateResult {
  render: RenderPage;
  log?: GenerateDebugLog;
  /**
   * One entry per composed-page screenshot pass (initial dispatch + each
   * send_feedback round), each containing mobile/tablet/desktop JPEGs.
   */
  screenshots?: PreviewScreenshots[];
}

/**
 * Progress events emitted during an orchestrator run. Includes everything the
 * single-agent generator emits plus sub-agent bubble-through events and a
 * composed-page screenshot event for each knit+render round.
 */
export type ProgressEvent =
  | { type: 'fake_data_done'; data: Record<string, unknown> }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'step_finish'; step: StreamStepInfo }
  | SubagentProgressEvent
  | {
      type: 'composed_page';
      screenshots: Record<Viewport, string>;
    };

/**
 * Maximum number of send_feedback rounds the orchestrator may run after the
 * initial dispatch. Two rounds is the ceiling chosen in the design — enough
 * for the orchestrator to nudge a few sections in response to cohesion
 * problems, but tight enough that the strong-model cost stays bounded.
 */
const MAX_FEEDBACK_ROUNDS = 2;

interface OrchestratorRuntime {
  sandbox: SandboxInstance;
  previewData: Record<string, unknown>;
  inputSchemaTs: string;
  client: ObjectGenerator;
  reviewClient: ObjectGenerator;
  sectionSystemPrompt: string;
  accountId: string;
  apiToken: string;
  /** Populated by dispatch_sections; read by send_feedback and the final knit. */
  sections: Section[];
  /** Per-section persisted conversation + source. Survives across tool calls. */
  subagentStates: Map<string, SubagentState>;
  /** Incremented each send_feedback invocation; capped at MAX_FEEDBACK_ROUNDS. */
  feedbackRoundsUsed: number;
  onProgress?: (event: ProgressEvent) => void | Promise<void>;
  debugScreenshots: PreviewScreenshots[];
  debug: boolean;
}

/**
 * Build + screenshot the composed page at all three viewports. Used after
 * dispatch_sections and each send_feedback call to give the orchestrator
 * fresh cohesion-level visual feedback.
 */
async function composedPageScreenshots(
  runtime: OrchestratorRuntime
): Promise<{ record: Record<Viewport, string>; raw: PreviewScreenshots }> {
  const bundleResult = await buildBundle(runtime.sandbox);
  if (!bundleResult.success) {
    throw new Error(
      `Failed to build composed page: ${bundleResult.errors ?? 'unknown'}`
    );
  }
  const html = makeRender(bundleResult.bundle!)({ data: runtime.previewData });
  const shots = await screenshotAllViewports({
    html,
    accountId: runtime.accountId,
    apiToken: runtime.apiToken,
  });
  return {
    raw: shots,
    record: {
      mobile: uint8ToBase64(shots.mobile),
      tablet: uint8ToBase64(shots.tablet),
      desktop: uint8ToBase64(shots.desktop),
    },
  };
}

function dispatchSectionsTool(runtime: OrchestratorRuntime): StreamTool {
  return {
    description:
      'Spawn one sub-agent per section in parallel. Each sub-agent runs its own write → preview → review loop and converges to a best-effort component for its section. After all sub-agents finish, the host deterministically knits the sections into a composed page, screenshots it at mobile/tablet/desktop, and returns those screenshots to you. Call this FIRST, exactly once, after you have decided the taxonomy.',
    inputSchema: z.object({
      sections: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                'lowercase slug identifier; used as the sub-agent key and filename (a-z, 0-9, -).'
              ),
            brief: z
              .string()
              .describe(
                'prose description of what this section renders — the sub-agent is given this plus the full data schema and must produce a component for it.'
              ),
          })
        )
        .describe(
          'The page sections, in render order. Sub-agents run in parallel and the composed page renders them top-to-bottom in this order.'
        ),
    }),
    async execute(args: unknown) {
      const { sections } = args as { sections: Section[] };
      runtime.sections = sections;

      await Promise.all(
        sections.map(async (section) => {
          const state = await runSectionSubagent({
            section,
            previewData: runtime.previewData,
            inputSchemaTs: runtime.inputSchemaTs,
            sandbox: runtime.sandbox,
            client: runtime.client,
            reviewClient: runtime.reviewClient,
            sectionSystemPrompt: runtime.sectionSystemPrompt,
            accountId: runtime.accountId,
            apiToken: runtime.apiToken,
            onProgress: runtime.onProgress,
          });
          runtime.subagentStates.set(section.name, state);
        })
      );

      await knitSections(runtime.sandbox, sections);
      const { record, raw } = await composedPageScreenshots(runtime);
      if (runtime.debug) runtime.debugScreenshots.push(raw);
      await runtime.onProgress?.({
        type: 'composed_page',
        screenshots: record,
      });

      return {
        type: 'composed',
        sectionNames: sections.map((s) => s.name),
        screenshots: record,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as {
        type: 'composed';
        sectionNames: string[];
        screenshots: Record<Viewport, string>;
      };
      return viewportScreenshotContent(
        `All ${
          result.sectionNames.length
        } section sub-agents finished and the pages were knit into the composed page shown below. Sections: ${result.sectionNames.join(
          ', '
        )}. Review cohesion across viewports — vertical rhythm, density parity between sections, typographic consistency, whether any section looks out of place in the composition. If satisfied, call submit. Otherwise call send_feedback with per-section notes; you have up to ${MAX_FEEDBACK_ROUNDS} feedback rounds.`,
        result.screenshots
      );
    },
  };
}

function sendFeedbackTool(runtime: OrchestratorRuntime): StreamTool {
  return {
    description:
      'Send targeted feedback to one or more section sub-agents. Each targeted sub-agent resumes from its prior state, revises its section with the feedback, and iterates to approval or budget. After all targeted sub-agents finish, the host re-knits and returns fresh composed-page screenshots. You can call this up to 2 times total before you must call submit.',
    inputSchema: z.object({
      feedback: z
        .record(z.string(), z.string())
        .describe(
          'Per-section feedback, keyed by section name. Only sections in this object re-run; omitted sections stay as they are. Empty object = no-op (use submit instead).'
        ),
    }),
    async execute(args: unknown) {
      const { feedback } = args as { feedback: Record<string, string> };
      if (runtime.feedbackRoundsUsed >= MAX_FEEDBACK_ROUNDS) {
        return {
          status: 'error',
          message: `Feedback budget exhausted (used ${runtime.feedbackRoundsUsed} of ${MAX_FEEDBACK_ROUNDS} rounds). Call submit to finalize.`,
        };
      }
      runtime.feedbackRoundsUsed += 1;

      const targets = Object.entries(feedback).filter(([name]) =>
        runtime.sections.some((s) => s.name === name)
      );

      await Promise.all(
        targets.map(async ([name, fb]) => {
          const section = runtime.sections.find((s) => s.name === name)!;
          const priorState = runtime.subagentStates.get(name);
          if (!priorState) return;
          const newState = await runSectionSubagent({
            section,
            previewData: runtime.previewData,
            inputSchemaTs: runtime.inputSchemaTs,
            sandbox: runtime.sandbox,
            client: runtime.client,
            reviewClient: runtime.reviewClient,
            sectionSystemPrompt: runtime.sectionSystemPrompt,
            accountId: runtime.accountId,
            apiToken: runtime.apiToken,
            resumeFrom: { state: priorState, orchestratorFeedback: fb },
            onProgress: runtime.onProgress,
          });
          runtime.subagentStates.set(name, newState);
        })
      );

      await knitSections(runtime.sandbox, runtime.sections);
      const { record, raw } = await composedPageScreenshots(runtime);
      if (runtime.debug) runtime.debugScreenshots.push(raw);
      await runtime.onProgress?.({
        type: 'composed_page',
        screenshots: record,
      });

      return {
        type: 'composed',
        roundsUsed: runtime.feedbackRoundsUsed,
        roundsRemaining: MAX_FEEDBACK_ROUNDS - runtime.feedbackRoundsUsed,
        retargetedSections: targets.map(([name]) => name),
        screenshots: record,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as
        | {
            type: 'composed';
            roundsUsed: number;
            roundsRemaining: number;
            retargetedSections: string[];
            screenshots: Record<Viewport, string>;
          }
        | { status: 'error'; message: string };

      if ('status' in result && result.status === 'error') {
        return {
          type: 'content',
          value: [{ type: 'text', text: result.message }],
        };
      }

      const composed = result as {
        type: 'composed';
        roundsUsed: number;
        roundsRemaining: number;
        retargetedSections: string[];
        screenshots: Record<Viewport, string>;
      };

      return viewportScreenshotContent(
        `Re-ran sub-agents for: ${composed.retargetedSections.join(
          ', '
        )}. Composed page screenshots attached. ${
          composed.roundsRemaining
        } feedback round(s) remaining; after that you must call submit.`,
        composed.screenshots
      );
    },
  };
}

function submitTool(): StreamTool {
  return {
    description:
      'Finalize the composed page. Call this when you are satisfied with cohesion (or when the feedback budget is spent and there is nothing left to improve).',
    inputSchema: z.object({}),
    async execute() {
      return { status: 'success' };
    },
  };
}

/**
 * Entry point for the orchestrator pattern — parallel of generate().
 *
 * Uses a strong model (orchestratorClient, defaults to client) to plan the
 * taxonomy, dispatches per-section sub-agents in parallel, knits their output
 * into a composed page, and loops on cohesion feedback up to
 * MAX_FEEDBACK_ROUNDS before submitting.
 */
export async function orchestrate(params: {
  client: ObjectGenerator;
  /** Strong model for taxonomy + cohesion review. Defaults to `client`. */
  orchestratorClient?: ObjectGenerator;
  /** Reviewer for per-section preview. Defaults to `client`. */
  reviewClient?: ObjectGenerator;
  sandbox: SandboxInstance;
  /** System prompt given to each section sub-agent + its per-section reviewer. */
  sectionSystemPrompt: string;
  /** System prompt given to the orchestrator itself (macro design guide). */
  orchestratorSystemPrompt: string;
  accountId: string;
  apiToken: string;
  prompt: string;
  inputSchema: ZodObject<any>;
  debug?: boolean;
  onProgress?: (event: ProgressEvent) => void | Promise<void>;
  previewData?: Record<string, unknown>;
}): Promise<GenerateResult> {
  const {
    client,
    orchestratorClient,
    reviewClient,
    sandbox,
    sectionSystemPrompt,
    orchestratorSystemPrompt,
    accountId,
    apiToken,
    prompt,
    inputSchema,
    debug = false,
    onProgress,
    previewData: cachedPreviewData,
  } = params;

  const startTime = Date.now();
  const inputSchemaTs = zodToTypescript(inputSchema, 'Data');

  // Fake data — cached from run.sh or regenerated. Orchestrator pattern is
  // read-only for v1 (no outputSchema).
  const previewData =
    cachedPreviewData ??
    ((await generateFakeData({
      client,
      schema: inputSchema,
      prompt,
    })) as Record<string, unknown>);

  await onProgress?.({ type: 'fake_data_done', data: previewData });

  const runtime: OrchestratorRuntime = {
    sandbox,
    previewData,
    inputSchemaTs,
    client,
    reviewClient: reviewClient ?? client,
    sectionSystemPrompt,
    accountId,
    apiToken,
    sections: [],
    subagentStates: new Map(),
    feedbackRoundsUsed: 0,
    onProgress,
    debugScreenshots: [],
    debug,
  };

  const rawTools: Record<string, StreamTool> = {
    dispatch_sections: dispatchSectionsTool(runtime),
    send_feedback: sendFeedbackTool(runtime),
    submit: submitTool(),
  };

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
        await onProgress?.({
          type: 'tool_result',
          tool: name,
          result: stripProgressImageBytes(result),
        });
        return result;
      },
    };
  }

  const userPrompt = `The user has requested the following page:

<user_request>
${prompt}
</user_request>

The page will receive data conforming to this schema:

\`\`\`typescript
${inputSchemaTs}
\`\`\`

Your job:

1. Decide the taxonomy — break the page into logical sections. Each section is rendered as its own React component by a sub-agent, then all sections are stacked vertically in the order you choose.
2. Call dispatch_sections exactly once with the list of sections. Each section needs a short name (lowercase slug) and a brief describing what it renders. Sub-agents run in parallel.
3. When the composed-page screenshots come back, review cohesion across mobile, tablet, and desktop. You're the only reviewer at the whole-page level — sub-agents only see their own sections.
4. If the composition has cross-section problems (vertical rhythm, density inconsistency, typographic drift, sections that feel out of place), call send_feedback with targeted notes per section. You have ${MAX_FEEDBACK_ROUNDS} feedback round(s) maximum; use them sparingly.
5. Call submit when satisfied OR when feedback rounds are exhausted.

Keep section briefs tight and specific. A sub-agent given "render the people section" will do much worse than one given "render the employees list: grouped by department, show name/title/status, surface on-leave and pending-start visibly with a badge, keep each row compact."

Do NOT rewrite sections yourself — that's the sub-agent's job. You orchestrate.`;

  const orchestrator = orchestratorClient ?? client;

  const result = await orchestrator.streamText({
    system: orchestratorSystemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 6,
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

  // If the orchestrator never called dispatch_sections (pathological —
  // model bailed before doing anything), there's no composed page to render.
  if (runtime.sections.length === 0) {
    throw new Error(
      'Orchestrator terminated without dispatching any sections — no page was composed.'
    );
  }

  // Final bundle using the knitted /workspace/component.tsx that the last
  // dispatch/feedback call wrote.
  const bundleResult = await buildBundle(sandbox);
  if (!bundleResult.success) {
    throw new Error(`Failed to build final bundle: ${bundleResult.errors}`);
  }

  const finalResult: GenerateResult = {
    render: makeRender(bundleResult.bundle!),
  };

  if (debug) {
    finalResult.screenshots = runtime.debugScreenshots;
    const truncatedSubagentStates = Object.fromEntries(
      Array.from(runtime.subagentStates.entries()).map(([name, state]) => [
        name,
        {
          componentSource: state.componentSource,
        },
      ])
    );
    finalResult.log = {
      orchestratorConversation: truncateImages(result.responseMessages),
      subagentStates: truncatedSubagentStates,
      sections: runtime.sections,
      data: previewData,
      totalDurationMs: Date.now() - startTime,
    };
  }

  return finalResult;
}
