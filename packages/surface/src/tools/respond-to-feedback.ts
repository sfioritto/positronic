import { z } from 'zod';
import type { ObjectGenerator, StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { writeComponentTool } from './write-component.js';
import { showComponentSourceTool } from './show-component-source.js';
import type { ReviewState } from './preview.js';

export function respondToFeedbackTool(
  client: ObjectGenerator,
  sandbox: SandboxInstance,
  systemPrompt: string,
  inputSchemaTs: string,
  outputSchemaTs: string | undefined,
  reviewState: ReviewState
): StreamTool {
  return {
    description:
      'Hand the reviewer feedback to a revision sub-agent. The sub-agent reads the current component source from the sandbox, applies the changes, and writes a revised version that type-checks. Call this after a rejected preview instead of editing the component yourself — it keeps your context clean and lets the sub-agent iterate on type errors if needed.',
    inputSchema: z.object({
      instructions: z
        .string()
        .describe(
          'What the sub-agent should change. Usually the raw reviewer issues list, but you can also rewrite it as more specific instructions (e.g. "Add a colored left border to each section header and move the submit button to the bottom outside every section").'
        ),
    }),
    async execute(args: unknown) {
      const { instructions } = args as { instructions: string };
      const current = await sandbox.readFile('/workspace/component.tsx');

      const subPrompt = `You are revising a React component to address reviewer feedback.

The current component source is:
\`\`\`tsx
${current.content}
\`\`\`

The data prop conforms to this schema:
\`\`\`ts
${inputSchemaTs}
\`\`\`
${
  outputSchemaTs
    ? `
The form (if present) submits data shaped like:
\`\`\`ts
${outputSchemaTs}
\`\`\`
`
    : ''
}
Apply this feedback to the component:

${instructions}

Workflow:
1. If the feedback names a specific shadcn component (Button, Field, Checkbox, etc.) you are unsure about, call show_component_source for it first.
2. Call write_component with the COMPLETE revised TSX source. Do not send a partial diff.
3. If write_component returns type errors, fix them and call it again.

Stop as soon as write_component returns status: success. Do not call any other tool after a successful write.`;

      await client.streamText({
        system: systemPrompt,
        prompt: subPrompt,
        tools: {
          write_component: writeComponentTool(sandbox, inputSchemaTs),
          show_component_source: showComponentSourceTool(),
        },
        maxSteps: 5,
        toolChoice: 'required',
        stopWhen: ({ steps }) => {
          const last = steps[steps.length - 1] as
            | { toolResults?: Array<{ toolName: string; output: unknown }> }
            | undefined;
          return (
            last?.toolResults?.some(
              (r) =>
                r.toolName === 'write_component' &&
                (r.output as { status?: string } | undefined)?.status ===
                  'success'
            ) ?? false
          );
        },
      });

      reviewState.feedbackAttempts += 1;

      return {
        status: 'success',
        message:
          'Component revised by sub-agent. Call preview to see the new screenshots.',
        feedbackAttempts: reviewState.feedbackAttempts,
      };
    },
  };
}
