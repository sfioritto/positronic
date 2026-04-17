import { z } from 'zod';
import type { ObjectGenerator, StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { buildBundle, makeRender } from '../sandbox.js';
import { screenshot } from '../screenshot.js';

export interface ReviewState {
  approved: boolean;
}

const REVIEW_SYSTEM = `You are a strict UI quality reviewer for a code-generation system.

Another LLM just generated a React component and rendered it to the screenshot you are about to see. Your job is to decide whether the rendered layout (a) satisfies every explicit visual requirement in the user's prompt AND (b) looks polished enough to ship.

You evaluate in two passes. BOTH must pass for approved=true.

PASS 1 — Explicit-requirements check (blocking):
First, enumerate every concrete visual requirement the user asked for in their prompt. Then for each requirement, judge from the screenshot whether it is fulfilled. If ANY requirement is unfulfilled, set approved=false and include it in the issues list — regardless of how polished the rest looks. Do not trade overall polish against an unmet explicit requirement.

Examples of requirements to extract and check:
- "Show the recommended articles with a subtle highlight or accent" → the Recommended section must have a visible color accent, tint, or distinguishing border (not merely a different label).
- "Title as a clickable link" → titles must have visible link affordance (color difference, underline, or similar cue).
- "A checkbox to mark as 'read'" → every item must show a visible checkbox.
- "Submit button at the bottom" → there must be a single button in a footer-like position, distinct from item controls.

If the prompt uses words like "subtle", "clear", "prominent", "distinguishable", "accent", "highlight", "badge", "separator" — those are explicit requirements. Check each one.

PASS 2 — Polish critique (only if Pass 1 had zero failures):
Judge overall visual polish. Fail on issues that would make a human designer re-open the file. Specifically watch for:
1. Text clipping or bad wrapping — content cut off at an edge, or wrapped to 1–5 characters per line.
2. Lopsided columns — one column squeezed thin while a sibling takes excessive width.
3. Isolated controls — checkboxes/buttons stranded in whitespace far from related content.
4. Broken alignment — labels not aligned with their controls, rows not aligned to a common edge.
5. Vertical rhythm — unexplained large gaps, or elements overlapping.
6. Overall polish — does it look like something a human designer would actually ship?

Rules that apply to both passes:
- You are the quality gate, not a cheerleader. Do not approve work that "kind of works but looks weird".
- Within Pass 2 only: if in doubt, approve. (Pass 1 is strict — requirements are either fulfilled or not.)
- Be specific. Vague feedback like "spacing could be improved" is useless. Describe the defect concretely: where it is, what's wrong, what it looks like.
- Do not suggest code fixes. Describe the visual problem only; the generator will figure out how to fix it.
- Do not comment on copy/content unless it is obviously broken (e.g. placeholder "Lorem ipsum" left in).`;

const ReviewVerdict = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
});

type ReviewResult = z.infer<typeof ReviewVerdict>;

export function previewTool(
  sandbox: SandboxInstance,
  fakeData: Record<string, unknown>,
  accountId: string,
  apiToken: string,
  reviewConfig: {
    client: ObjectGenerator;
    userPrompt: string;
    inputSchemaTs: string;
    outputSchemaTs?: string;
  },
  reviewState: ReviewState,
  options?: {
    debug?: boolean;
    screenshots?: Uint8Array[];
  }
): StreamTool {
  return {
    description:
      'Build and screenshot the component currently in the sandbox with sample data, then have it reviewed by an independent quality reviewer. Returns the screenshot plus the reviewer verdict. You cannot submit until the reviewer approves.',
    inputSchema: z.object({}),
    async execute() {
      const bundleResult = await buildBundle(sandbox);
      if (!bundleResult.success) {
        return {
          status: 'error',
          message: 'Failed to build HTML.',
          errors: bundleResult.errors,
        };
      }

      const html = makeRender(bundleResult.bundle!)({ data: fakeData });

      const png = await screenshot({
        html,
        accountId,
        apiToken,
      });

      if (options?.debug && options.screenshots) {
        options.screenshots.push(png);
      }

      const reviewPrompt = `The user asked for the following component:

<user_request>
${reviewConfig.userPrompt}
</user_request>

The component receives a \`data\` prop shaped like:
\`\`\`typescript
${reviewConfig.inputSchemaTs}
\`\`\`
${
  reviewConfig.outputSchemaTs
    ? `
It should include a form that submits data shaped like:
\`\`\`typescript
${reviewConfig.outputSchemaTs}
\`\`\`
`
    : ''
}
Review the attached screenshot. Approve only if the layout is clean and production-quality.`;

      const { object: verdict } = await reviewConfig.client.generateObject({
        schema: ReviewVerdict,
        schemaName: 'ReviewVerdict',
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt,
        attachments: [
          { name: 'screenshot.png', mimeType: 'image/png', data: png },
        ],
      });

      reviewState.approved = verdict.approved;

      let binary = '';
      for (let i = 0; i < png.length; i++) {
        binary += String.fromCharCode(png[i]);
      }
      const base64 = btoa(binary);

      return {
        type: 'preview',
        image: base64,
        verdict,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as
        | { type: 'preview'; image: string; verdict: ReviewResult }
        | { status: 'error'; message: string; errors?: unknown };

      if ('status' in result && result.status === 'error') {
        return {
          type: 'content',
          value: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      if ('type' in result && result.type === 'preview') {
        const { verdict, image } = result;
        const reviewText = verdict.approved
          ? `REVIEW: APPROVED. The reviewer confirms the layout is production-quality. You may call submit.`
          : `REVIEW: NEEDS WORK. The reviewer flagged these issues:

${verdict.issues.map((i) => `- ${i}`).join('\n')}

Before rewriting: if any issue above names a specific component (e.g. "Button is rendering as plain text", "Checkbox looks wrong"), you MUST call show_component_source for that component first to see how it is actually implemented. Only after reading the source should you call write_component. Do NOT call submit — it will be refused until the reviewer approves.`;

        return {
          type: 'content',
          value: [
            { type: 'text', text: reviewText },
            { type: 'media', data: image, mediaType: 'image/png' },
          ],
        };
      }

      return {
        type: 'content',
        value: [{ type: 'text', text: JSON.stringify(output) }],
      };
    },
  };
}
