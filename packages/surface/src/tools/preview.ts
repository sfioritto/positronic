import { z } from 'zod';
import type { ObjectGenerator, StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { buildBundle, makeRender } from '../sandbox.js';
import {
  screenshotAllViewports,
  VIEWPORTS,
  VIEWPORT_DIMENSIONS,
  type Viewport,
} from '../screenshot.js';

export interface ReviewState {
  approved: boolean;
}

const REVIEW_SYSTEM = `You are a strict UI quality reviewer for a code-generation system.

Another LLM just generated a React component and rendered it. You will see THREE screenshots of the same page — the mobile viewport (${VIEWPORT_DIMENSIONS.mobile.width}px wide), the tablet viewport (${VIEWPORT_DIMENSIONS.tablet.width}px wide), and the desktop viewport (${VIEWPORT_DIMENSIONS.desktop.width}px wide). They are attached in that order.

Your job is to decide whether the layout (a) satisfies every explicit visual requirement in the user's prompt AND (b) looks polished across ALL three viewports.

You evaluate in two passes. BOTH must pass for approved=true.

PASS 1 — Explicit-requirements check (blocking):
Enumerate every concrete visual requirement the user asked for in their prompt. For each, judge from the screenshots whether it is fulfilled. If ANY requirement is unfulfilled in any viewport, set approved=false and include it in the issues list — regardless of how polished the rest looks. Do not trade overall polish against an unmet explicit requirement.

Examples of requirements to extract and check:
- "Show the recommended articles with a subtle highlight or accent" → the Recommended section must have a visible color accent, tint, or distinguishing border (not merely a different label).
- "Title as a clickable link" → titles must have visible link affordance (color difference, underline, or similar cue).
- "A checkbox to mark as 'read'" → every item must show a visible checkbox.
- "Submit button at the bottom" → there must be a single button in a footer-like position, distinct from item controls.

If the prompt uses words like "subtle", "clear", "prominent", "distinguishable", "accent", "highlight", "badge", "separator" — those are explicit requirements. Check each one.

PASS 2 — Polish critique across all viewports (only if Pass 1 had zero failures):
Judge visual polish at EACH viewport. The same design often succeeds at one width and breaks at another — a design that only works at desktop is not production-quality. Flag any issue present in any viewport and name which viewport(s) it affects.

Specifically watch for:
1. Responsive breakage — content that looks fine on desktop but clips, cramps, stacks awkwardly, or hides itself on mobile/tablet. This is often the highest-impact class of defect.
2. Text clipping or bad wrapping at any viewport — content cut off at an edge, or wrapped to 1–5 characters per line.
3. Lopsided columns — one column squeezed thin while a sibling takes excessive width. Common cause of mobile breakage.
4. Isolated controls — checkboxes/buttons stranded in whitespace far from related content (especially at wide viewports where excessive whitespace appears).
5. Broken alignment — labels not aligned with their controls, rows not aligned to a common edge.
6. Vertical rhythm — unexplained large gaps, or elements overlapping.
7. Layout-primitive appropriateness — are the chosen layout elements a good fit for the content? Examples of mismatches worth flagging:
   - A stack of many identical bordered Cards for a read-only list of similar items when a typographic list with Separators would read better.
   - Dense dashboard-style metric cards for editorial or report-like content.
   - Heavy container chrome (borders, shadows) on content that would feel lighter with just whitespace + hierarchy.
   - A \`Table\` used for content that isn't truly row/column tabular.
   - Cards nested inside cards for no visual reason.
   - A multi-column desktop layout that stacks unhelpfully on mobile because the columns never collapse.
   Do not flag card use itself as wrong — flag mismatches where the chosen primitive is fighting the content.
8. Overall polish — does it look like something a human designer would actually ship, on every viewport?

When you write issues, mention the viewport when the problem is viewport-specific (e.g. "Mobile: the three-column stat row wraps awkwardly, making each stat label land alone on its own line"). If an issue affects all viewports, just describe it without the viewport prefix.

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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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
    screenshots?: Array<Record<Viewport, Uint8Array>>;
  }
): StreamTool {
  return {
    description:
      'Build and screenshot the component currently in the sandbox with sample data at mobile, tablet, and desktop viewports, then have all three reviewed by an independent quality reviewer. Returns the screenshots plus the reviewer verdict. You cannot submit until the reviewer approves.',
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

      const shots = await screenshotAllViewports({
        html,
        accountId,
        apiToken,
      });

      if (options?.debug && options.screenshots) {
        options.screenshots.push(shots);
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
Attached: three screenshots of the same page at mobile (${
        VIEWPORT_DIMENSIONS.mobile.width
      }px), tablet (${VIEWPORT_DIMENSIONS.tablet.width}px), and desktop (${
        VIEWPORT_DIMENSIONS.desktop.width
      }px) viewports, in that order. Approve only if the layout satisfies the user's requirements AND is polished across ALL three viewports.`;

      const { object: verdict } = await reviewConfig.client.generateObject({
        schema: ReviewVerdict,
        schemaName: 'ReviewVerdict',
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt,
        attachments: VIEWPORTS.map((viewport) => ({
          name: `screenshot-${viewport}.png`,
          mimeType: 'image/png',
          data: shots[viewport],
        })),
      });

      reviewState.approved = verdict.approved;

      const images: Record<Viewport, string> = {
        mobile: uint8ToBase64(shots.mobile),
        tablet: uint8ToBase64(shots.tablet),
        desktop: uint8ToBase64(shots.desktop),
      };

      return {
        type: 'preview',
        images,
        verdict,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as
        | {
            type: 'preview';
            images: Record<Viewport, string>;
            verdict: ReviewResult;
          }
        | { status: 'error'; message: string; errors?: unknown };

      if ('status' in result && result.status === 'error') {
        return {
          type: 'content',
          value: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      if ('type' in result && result.type === 'preview') {
        const { verdict, images } = result;
        const reviewText = verdict.approved
          ? `REVIEW: APPROVED across mobile, tablet, and desktop viewports. The reviewer confirms the layout is production-quality. You may call submit.`
          : `REVIEW: NEEDS WORK. The reviewer flagged these issues (evaluated across mobile, tablet, and desktop viewports):

${verdict.issues.map((i) => `- ${i}`).join('\n')}

Before rewriting: if any issue above names a specific component (e.g. "Button is rendering as plain text", "Checkbox looks wrong"), you MUST call show_component_source for that component first to see how it is actually implemented. Only after reading the source should you call write_component. Do NOT call submit — it will be refused until the reviewer approves.

The three screenshots are attached in order: mobile, tablet, desktop. Look at each before deciding what to change.`;

        return {
          type: 'content',
          value: [
            { type: 'text', text: reviewText },
            {
              type: 'text',
              text: `Mobile (${VIEWPORT_DIMENSIONS.mobile.width}px wide):`,
            },
            {
              type: 'media',
              data: images.mobile,
              mediaType: 'image/png',
            },
            {
              type: 'text',
              text: `Tablet (${VIEWPORT_DIMENSIONS.tablet.width}px wide):`,
            },
            {
              type: 'media',
              data: images.tablet,
              mediaType: 'image/png',
            },
            {
              type: 'text',
              text: `Desktop (${VIEWPORT_DIMENSIONS.desktop.width}px wide):`,
            },
            {
              type: 'media',
              data: images.desktop,
              mediaType: 'image/png',
            },
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
