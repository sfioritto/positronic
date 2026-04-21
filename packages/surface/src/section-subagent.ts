import { z } from 'zod';
import type {
  ObjectGenerator,
  StreamTool,
  StreamStepInfo,
} from '@positronic/core';
import type { SandboxInstance } from './sandbox.js';
import { buildBundle, makeRender, typeCheck } from './sandbox.js';
import {
  screenshotAllViewports,
  VIEWPORTS,
  VIEWPORT_DIMENSIONS,
  type Viewport,
} from './screenshot.js';
import { showComponentSourceTool } from './tools/show-component-source.js';
import { REVIEW_SYSTEM, ReviewVerdict } from './tools/preview.js';
import {
  stripProgressImageBytes,
  uint8ToBase64,
  viewportScreenshotContent,
} from './lib/progress-sanitize.js';

/**
 * One section of the final page. The orchestrator emits these as taxonomy.
 * `name` is used as the filename under /workspace/sections/ and as the
 * feedback-target key when the orchestrator calls send_feedback.
 */
export interface Section {
  name: string;
  brief: string;
}

/**
 * Persisted between orchestrator rounds so sub-agents can pick up where they
 * left off. Lives in memory on the host (inside one fetch invocation).
 */
export interface SubagentState {
  /** Current TSX source committed to /workspace/sections/<name>.tsx. */
  componentSource: string;
}

/** Events surfaced to the host during a section sub-agent run. */
export type SubagentProgressEvent =
  | { type: 'subagent_tool_start'; section: string; tool: string }
  | {
      type: 'subagent_tool_result';
      section: string;
      tool: string;
      result: unknown;
    }
  | { type: 'subagent_step_finish'; section: string; step: StreamStepInfo };

/**
 * Max preview rounds a section sub-agent will attempt before force-approving
 * its current best attempt and returning. Matches MAX_FEEDBACK_ATTEMPTS in
 * the single-agent preview tool — kept local here to keep sections
 * independent of that tool's evolving review-budget semantics.
 */
const SECTION_MAX_PREVIEW_ROUNDS = 3;

const SECTION_NAME_RE = /^[a-z][a-z0-9-]*$/;

function validateSectionName(name: string) {
  if (!SECTION_NAME_RE.test(name)) {
    throw new Error(
      `Invalid section name "${name}": must be lowercase, start with a letter, use only a-z/0-9/-.`
    );
  }
}

/**
 * Stamp a per-section mount entry that renders ONLY this section as the page
 * root. Bundled separately from other sections so parallel sub-agents don't
 * collide on /workspace/page.bundle.js. Content mirrors the Dockerfile's
 * base mount template (flushSync → fonts.ready → data-rendered) so the
 * screenshot timing fix still applies.
 */
async function stampSectionMount(
  sandbox: SandboxInstance,
  sectionName: string
): Promise<void> {
  const source = `import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Section from './sections/${sectionName}.tsx';

const data = (window as any).__POSITRONIC_DATA__ || {};
const root = createRoot(document.getElementById('root')!);
flushSync(() => {
  root.render(<Section data={data} />);
});

document.fonts.ready.then(() => {
  requestAnimationFrame(() => {
    document.body.dataset.rendered = 'true';
  });
});
`;
  await sandbox.writeFile(`/workspace/mount-${sectionName}.tsx`, source);
}

/**
 * Stamp a per-section tsconfig narrowing `include` to just this section's
 * file, types.ts, and the shadcn library. Parallel sub-agents then don't
 * trip over each other's half-written peer sections — each runs tsc against
 * its own tiny project. Inherits compilerOptions from the base tsconfig.
 */
async function stampSectionTsconfig(
  sandbox: SandboxInstance,
  sectionName: string
): Promise<void> {
  const source = JSON.stringify(
    {
      extends: './tsconfig.json',
      include: [
        'types.ts',
        `sections/${sectionName}.tsx`,
        'sections/types.ts',
        'surface/components/**/*',
        'surface/lib/utils.ts',
      ],
    },
    null,
    2
  );
  await sandbox.writeFile(`/workspace/tsconfig-${sectionName}.json`, source);
}

/**
 * Sections live in /workspace/sections/ so an `import from './types'` inside
 * a section resolves to /workspace/sections/types.ts, not the root
 * /workspace/types.ts. Write a shim next to the section file so the natural
 * relative import the LLM generates resolves correctly.
 */
async function stampSectionTypesShim(
  sandbox: SandboxInstance,
  inputSchemaTs: string
): Promise<void> {
  await sandbox.writeFile('/workspace/sections/types.ts', inputSchemaTs);
}

/**
 * Section-scoped write_component. Writes to /workspace/sections/<name>.tsx
 * so parallel sub-agents don't collide, and runs the standard tsc pass.
 */
function sectionWriteComponentTool(
  sandbox: SandboxInstance,
  sectionName: string,
  inputSchemaTs: string
): StreamTool {
  return {
    description:
      'Write or rewrite the full TSX source for this section and type-check it. The file is automatically type-checked against the data schema and available shadcn components. Returns type errors if any, or success.',
    inputSchema: z.object({
      source: z
        .string()
        .describe('The complete TSX source code for the section component'),
    }),
    async execute({ source }: any) {
      if (/\bdata\s*:\s*(any|unknown)\b/.test(source)) {
        return {
          status: 'error',
          message:
            'Refusing to accept component: the data prop is typed as `any` or `unknown`, which bypasses schema checking. Declare `data` with the Data interface (e.g. `interface Props { data: Data }`).',
        };
      }
      await sandbox.writeFile(`/workspace/sections/${sectionName}.tsx`, source);
      const result = await typeCheck(sandbox, inputSchemaTs, {
        configPath: `/workspace/tsconfig-${sectionName}.json`,
      });
      if (result.success) {
        return {
          status: 'success',
          message: 'Section written and type-checks successfully.',
        };
      }
      return {
        status: 'error',
        message: 'Type errors found. Fix them and call write_component again.',
        errors: result.errors,
      };
    },
  };
}

interface SectionReviewState {
  approved: boolean;
  rounds: number;
}

/**
 * Section-scoped preview tool. Builds only this section's mount entry,
 * screenshots it at the three viewports, and runs the reviewer against the
 * section brief (not the whole-page prompt).
 */
function sectionPreviewTool(
  sandbox: SandboxInstance,
  sectionName: string,
  brief: string,
  previewData: Record<string, unknown>,
  accountId: string,
  apiToken: string,
  reviewClient: ObjectGenerator,
  inputSchemaTs: string,
  reviewState: SectionReviewState
): StreamTool {
  return {
    description:
      'Build and screenshot ONLY this section at mobile/tablet/desktop and get a reviewer verdict against the section brief. You cannot end the loop until the reviewer approves or the section runs out of preview rounds.',
    inputSchema: z.object({}),
    async execute() {
      const bundleResult = await buildBundle(sandbox, {
        entryPath: `/workspace/mount-${sectionName}.tsx`,
        outPrefix: `section-${sectionName}`,
      });
      if (!bundleResult.success) {
        return {
          status: 'error',
          message: 'Failed to build section preview.',
          errors: bundleResult.errors,
        };
      }

      const html = makeRender(bundleResult.bundle!)({ data: previewData });
      const shots = await screenshotAllViewports({
        html,
        accountId,
        apiToken,
      });

      const reviewPrompt = `This is one SECTION of a larger page. Evaluate it against the section brief only — cross-section cohesion is not your concern here.

<section_brief>
${brief}
</section_brief>

The section receives a \`data\` prop with this TypeScript interface:
\`\`\`typescript
${inputSchemaTs}
\`\`\`

Attached: three full-page screenshots of this section at mobile (${VIEWPORT_DIMENSIONS.mobile.width}px), tablet (${VIEWPORT_DIMENSIONS.tablet.width}px), and desktop (${VIEWPORT_DIMENSIONS.desktop.width}px), in that order. Approve only if the section fulfills the brief AND is polished across all three viewports.`;

      const { object: verdict } = await reviewClient.generateObject({
        schema: ReviewVerdict,
        schemaName: 'ReviewVerdict',
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt,
        attachments: VIEWPORTS.map((viewport) => ({
          name: `screenshot-${viewport}.jpg`,
          mimeType: 'image/jpeg',
          data: shots[viewport],
        })),
      });

      reviewState.rounds += 1;
      const budgetExhausted =
        !verdict.approved && reviewState.rounds >= SECTION_MAX_PREVIEW_ROUNDS;
      reviewState.approved = verdict.approved || budgetExhausted;

      const images: Record<Viewport, string> = {
        mobile: uint8ToBase64(shots.mobile),
        tablet: uint8ToBase64(shots.tablet),
        desktop: uint8ToBase64(shots.desktop),
      };

      return {
        type: 'preview',
        images,
        verdict,
        budgetExhausted,
        round: reviewState.rounds,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as
        | {
            type: 'preview';
            images: Record<Viewport, string>;
            verdict: { approved: boolean; issues: string[] };
            budgetExhausted: boolean;
            round: number;
          }
        | { status: 'error'; message: string; errors?: unknown };

      if ('status' in result && result.status === 'error') {
        return {
          type: 'content',
          value: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      if ('type' in result && result.type === 'preview') {
        const { verdict, images, budgetExhausted } = result;
        const reviewText = verdict.approved
          ? `REVIEW: APPROVED. The reviewer is satisfied — this section is done. Stop calling tools.`
          : budgetExhausted
          ? `REVIEW: BUDGET EXHAUSTED. The section's ${SECTION_MAX_PREVIEW_ROUNDS}-preview budget is spent and the reviewer still has ${
              verdict.issues.length
            } issue(s) open. The current TSX is the best attempt we have — stop calling tools.

Remaining issues (informational):

${verdict.issues.map((i) => `- ${i}`).join('\n')}`
          : `REVIEW: NEEDS WORK. Your next action is write_component with a revised version that addresses every issue below.

Issues (evaluated across mobile, tablet, and desktop — screenshots attached below in that order):

${verdict.issues.map((i) => `- ${i}`).join('\n')}

Look at each viewport screenshot, then call write_component with your fix.`;

        return viewportScreenshotContent(reviewText, images);
      }

      return {
        type: 'content',
        value: [{ type: 'text', text: JSON.stringify(output) }],
      };
    },
  };
}

/**
 * Run one section's generate-preview-iterate loop to local approval or the
 * preview-round budget. On budget exhaustion the best attempt is persisted
 * and returned — there is no failure flag; orchestrator only sees the
 * composed screenshot and decides whether to round again.
 *
 * When `resumeFrom` is present, the sub-agent picks up from the prior
 * responseMessages and continues with a new user message containing the
 * orchestrator's feedback, for a fresh round of preview budget.
 */
export async function runSectionSubagent(params: {
  section: Section;
  previewData: Record<string, unknown>;
  inputSchemaTs: string;
  sandbox: SandboxInstance;
  client: ObjectGenerator;
  reviewClient: ObjectGenerator;
  sectionSystemPrompt: string;
  accountId: string;
  apiToken: string;
  resumeFrom?: {
    state: SubagentState;
    orchestratorFeedback: string;
  };
  onProgress?: (event: SubagentProgressEvent) => void | Promise<void>;
}): Promise<SubagentState> {
  const {
    section,
    previewData,
    inputSchemaTs,
    sandbox,
    client,
    reviewClient,
    sectionSystemPrompt,
    accountId,
    apiToken,
    resumeFrom,
    onProgress,
  } = params;

  validateSectionName(section.name);
  await Promise.all([
    stampSectionMount(sandbox, section.name),
    stampSectionTsconfig(sandbox, section.name),
    stampSectionTypesShim(sandbox, inputSchemaTs),
  ]);

  const reviewState: SectionReviewState = { approved: false, rounds: 0 };

  const rawTools: Record<string, StreamTool> = {
    write_component: sectionWriteComponentTool(
      sandbox,
      section.name,
      inputSchemaTs
    ),
    show_component_source: showComponentSourceTool(),
    preview: sectionPreviewTool(
      sandbox,
      section.name,
      section.brief,
      previewData,
      accountId,
      apiToken,
      reviewClient,
      inputSchemaTs,
      reviewState
    ),
  };

  // Wrap with progress events so the host can stream section-scoped activity
  // back to run.sh. Strip raw image bytes from the forwarded result — the
  // screenshots are already emitted as composed_page events at the
  // orchestrator level, and dumping 100KB of base64 per NDJSON line makes
  // the log unreadable.
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
        await onProgress?.({
          type: 'subagent_tool_start',
          section: section.name,
          tool: name,
        });
        const result = await original(input);
        await onProgress?.({
          type: 'subagent_tool_result',
          section: section.name,
          tool: name,
          result: stripProgressImageBytes(result),
        });
        return result;
      },
    };
  }

  const userPrompt = resumeFrom
    ? `You previously wrote this section for a larger page. The orchestrator reviewed the composed page and asked for a revision.

Current section source:
\`\`\`tsx
${resumeFrom.state.componentSource}
\`\`\`

Orchestrator feedback:

<orchestrator_feedback>
${resumeFrom.orchestratorFeedback}
</orchestrator_feedback>

The section receives a \`data\` prop with this TypeScript interface:

\`\`\`typescript
${inputSchemaTs}
\`\`\`

Your next action is write_component with a revised version that addresses the orchestrator feedback. After it succeeds, call preview to confirm the section still satisfies its reviewer. Iterate until the reviewer approves or the preview budget is spent.`
    : `SECTION BRIEF: ${section.brief}

This section is part of a larger page. It receives a \`data\` prop with this TypeScript interface:

\`\`\`typescript
${inputSchemaTs}
\`\`\`

Destructure only the fields this section's brief requires — don't render anything the brief didn't ask for.

IMPORTANT: Import all components from '@surface/components'. Do NOT use '@/components/ui/...' paths.

Instructions:
1. Write the initial section using write_component — it will be type-checked automatically.
2. Fix any type errors and call write_component again.
3. Call preview to see the section's screenshots and get a reviewer verdict.
4. If rejected, rewrite the section with write_component addressing every issue, then call preview again.
5. Repeat until the reviewer approves or the preview budget is exhausted (both end the loop). Stop calling tools after that.`;

  const result = await client.streamText({
    system: sectionSystemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 20,
    toolChoice: 'required',
    onStepFinish: onProgress
      ? (step) =>
          onProgress({
            type: 'subagent_step_finish',
            section: section.name,
            step,
          })
      : undefined,
    stopWhen: ({ steps }) => {
      const last = steps[steps.length - 1] as
        | { toolResults?: Array<{ toolName: string; output: unknown }> }
        | undefined;
      const lastPreview = last?.toolResults?.find(
        (r) => r.toolName === 'preview'
      );
      if (!lastPreview) return false;
      const output = lastPreview.output as
        | {
            type?: string;
            verdict?: { approved: boolean };
            budgetExhausted?: boolean;
          }
        | undefined;
      if (!output || output.type !== 'preview') return false;
      return Boolean(output.verdict?.approved || output.budgetExhausted);
    },
  });

  const current = await sandbox.readFile(
    `/workspace/sections/${section.name}.tsx`
  );

  return {
    componentSource: current.content,
  };
}
