import type { ConfiguredPlugin, WebhookFunction } from '@positronic/core';

/**
 * Collect webhook declarations from all plugins.
 * Returns a manifest-compatible record mapping slug → WebhookFunction.
 *
 * Used by the generated index.ts to merge plugin webhooks into the
 * webhook manifest alongside file-based webhooks.
 */
export function collectPluginWebhooks(
  plugins: readonly ConfiguredPlugin[]
): Record<string, WebhookFunction<any>> {
  const result: Record<string, WebhookFunction<any>> = {};
  for (const plugin of plugins) {
    const webhooks = plugin.__plugin.webhooks;
    if (webhooks) {
      for (const wh of Object.values(webhooks)) {
        result[wh.slug] = wh;
      }
    }
  }
  return result;
}
