import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { buildBundle, makeRender } from '../sandbox.js';
import { screenshot } from '../screenshot.js';

export function previewTool(
  sandbox: SandboxInstance,
  fakeData: Record<string, unknown>,
  accountId: string,
  apiToken: string,
  options?: {
    debug?: boolean;
    screenshots?: Uint8Array[];
    previewState?: { count: number };
  }
): StreamTool {
  return {
    description:
      'Build and screenshot the component currently in the sandbox with sample data. Use this to see what your component looks like rendered in a browser.',
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

      if (options?.previewState) {
        options.previewState.count += 1;
      }

      // Return base64 image data — toModelOutput converts it to visual content
      // Build string in a loop to avoid call stack overflow from spread on large arrays
      let binary = '';
      for (let i = 0; i < png.length; i++) {
        binary += String.fromCharCode(png[i]);
      }
      const base64 = btoa(binary);
      return {
        type: 'image',
        data: base64,
      };
    },
    toModelOutput({ output }: { output: unknown }) {
      const result = output as { type: string; data?: string };
      if (result.type === 'image' && result.data) {
        return {
          type: 'content',
          value: [
            {
              type: 'text',
              text: `Screenshot of the rendered component. Critically review it before doing anything else — do NOT submit unless the layout is genuinely polished. Check for:

1. **Text clipping or bad wrapping.** Is any content cut off at the right/left edge? Is text wrapping to 1–5 characters per line? That means a parent is too narrow.
2. **Lopsided columns.** Is one column squeezed thin while a neighbor takes excessive width? This usually means a flex child has \`w-full\` or \`flex-auto\` that it shouldn't.
3. **Isolated controls.** Are checkboxes/buttons sitting alone in large empty space far from the content they belong to? That means the row layout is broken.
4. **Alignment.** Are labels aligned with their controls? Are rows in a list aligned to the same left edge?
5. **Vertical rhythm.** Are there unexplained large gaps between sibling elements? Is anything overlapping?
6. **Overall polish.** Does it look like something a human designer would actually ship? If your honest answer is "it kind of works but looks weird," it is NOT ready — call write_component again and fix it.

If you spot ANY of the above, call write_component again with a corrected version. Only call submit when the rendered layout is clean and production-quality.`,
            },
            { type: 'media', data: result.data, mediaType: 'image/png' },
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
