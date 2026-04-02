import { definePlugin } from '@positronic/core';
import type { ObjectGenerator } from '@positronic/core';
import { createSurfaceSandbox } from './sandbox/index.js';
import { generate, type GenerateResult } from './generate.js';
import systemPromptTemplate from './system-prompt.md';

export type SurfaceConfig = {
  /** LLM client for UI generation (typically a fast/cheap model) */
  client: ObjectGenerator;
  /** Cloudflare Sandbox DO namespace binding */
  sandbox: any;
  /** Cloudflare account ID for Browser Rendering API */
  accountId: string;
  /** Cloudflare API token with Browser Rendering permissions */
  apiToken: string;
  /** Import path for components in the sandbox (default: '@surface/components') */
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
 *   plugins: [surface.setup({
 *     client: fastModel,
 *     sandbox: env.SANDBOX,
 *     accountId: env.CLOUDFLARE_ACCOUNT_ID,
 *     apiToken: env.CLOUDFLARE_API_TOKEN,
 *   })],
 * });
 * ```
 */
export const surface = definePlugin({
  name: 'surface',

  setup: (config: SurfaceConfig) => config,

  create: ({ config }) => {
    const systemPrompt = systemPromptTemplate.replaceAll(
      '__IMPORT_PATH__',
      config.importPath ?? '@surface/components'
    );

    return {
      generate: async (params: {
        prompt: string;
        inputSchema: string;
        outputSchema?: string;
        debug?: boolean;
      }): Promise<GenerateResult> => {
        const sandbox = createSurfaceSandbox(config.sandbox);

        return generate({
          client: config.client,
          sandbox,
          systemPrompt,
          accountId: config.accountId,
          apiToken: config.apiToken,
          prompt: params.prompt,
          inputSchema: params.inputSchema,
          outputSchema: params.outputSchema,
          debug: params.debug,
        });
      },
    };
  },
});
