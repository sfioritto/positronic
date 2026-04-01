import { definePlugin } from '@positronic/core';
import type { ObjectGenerator } from '@positronic/core';
import { renderSystemPrompt } from './docs/render.js';

export type SurfaceConfig = {
  /** LLM client for UI generation (typically a fast/cheap model) */
  client: ObjectGenerator;
  /** Cloudflare Sandbox binding */
  sandbox?: unknown;
  /** Cloudflare Browser Rendering binding */
  browser?: unknown;
  /** Import path for components in the sandbox (default: '@positronic/surface') */
  importPath?: string;
};

/**
 * Surface plugin for AI-powered UI generation.
 *
 * @example
 * ```typescript
 * import { surface } from '@positronic/surface';
 *
 * const brain = createBrain({
 *   plugins: [surface.setup({ client: fastModel })],
 * });
 * ```
 */
export const surface = definePlugin({
  name: 'surface',

  setup: (config: SurfaceConfig) => config,

  create: ({ config }) => {
    const systemPrompt = renderSystemPrompt(
      config.importPath ?? '@positronic/surface'
    );

    return {
      generate: async (params: { dataShape: string; prompt: string }) => {
        // Will be implemented in Phase 4 (generation loop)
        // systemPrompt is ready — it'll be passed to streamText
        throw new Error(
          'Surface generate() not yet implemented — coming in Phase 4'
        );
      },
    };
  },
});
