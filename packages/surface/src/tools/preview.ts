import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { buildHtml } from '../sandbox.js';
import { screenshot } from '../screenshot.js';

export function previewTool(
  sandbox: SandboxInstance,
  fakeData: Record<string, unknown>,
  accountId: string,
  apiToken: string,
  options?: { debug?: boolean; screenshots?: Uint8Array[] }
): StreamTool {
  return {
    description:
      'Build and screenshot the component currently in the sandbox with sample data. Use this to see what your component looks like rendered in a browser.',
    inputSchema: z.object({}),
    async execute() {
      const htmlResult = await buildHtml(sandbox, fakeData);
      if (!htmlResult.success) {
        return {
          status: 'error',
          message: 'Failed to build HTML.',
          errors: htmlResult.errors,
        };
      }

      const png = await screenshot({
        html: htmlResult.html!,
        accountId,
        apiToken,
      });

      if (options?.debug && options.screenshots) {
        options.screenshots.push(png);
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
            { type: 'text', text: 'Screenshot of the rendered component:' },
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
