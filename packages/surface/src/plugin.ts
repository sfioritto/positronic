import { definePlugin } from '@positronic/core';
import type { ObjectGenerator } from '@positronic/core';
import type { ZodObject } from 'zod';
import {
  generate,
  type GenerateResult,
  type ProgressEvent,
} from './generate.js';
import type { SandboxInstance } from './sandbox.js';
import systemPromptTemplate from './system-prompt.gen.js';

export type SurfaceConfig = {
  /** LLM client for UI generation (typically a fast/cheap model) */
  client: ObjectGenerator;
  /**
   * LLM client for reviewing rendered screenshots. Should be a different
   * model than `client` so the reviewer does not share the generator's blind
   * spots. Falls back to `client` if not provided.
   */
  reviewClient?: ObjectGenerator;
  /** Cloudflare Sandbox DO namespace binding */
  sandbox: SandboxInstance;
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
        system?: string;
        inputSchema: ZodObject<any>;
        outputSchema?: ZodObject<any>;
        debug?: boolean;
        onProgress?: (event: ProgressEvent) => void | Promise<void>;
      }): Promise<GenerateResult> => {
        const { system, ...rest } = params;
        return generate({
          client: config.client,
          reviewClient: config.reviewClient ?? config.client,
          sandbox: config.sandbox,
          systemPrompt: system ? `${systemPrompt}\n\n${system}` : systemPrompt,
          accountId: config.accountId,
          apiToken: config.apiToken,
          ...rest,
        });
      },
    };
  },
});
