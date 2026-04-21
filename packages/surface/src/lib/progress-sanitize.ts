import type { JsonValue } from '@positronic/core';
import {
  VIEWPORTS,
  VIEWPORT_DIMENSIONS,
  type Viewport,
} from '../screenshot.js';

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Remove fields known to carry large base64 payloads from a progress event
 * payload. Progress events ride the NDJSON stream and get dumped line-by-line
 * by run.sh; a 100KB base64 blob per line makes the log unreadable and adds
 * nothing actionable. Host already emits the real screenshots via dedicated
 * composed_page events.
 */
export function stripProgressImageBytes(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  if (!('images' in record) && !('screenshots' in record)) return record;
  const copy: Record<string, unknown> = { ...record };
  delete copy.images;
  delete copy.screenshots;
  return copy;
}

/**
 * Walk a messages array (or any JSON structure) and replace any `data` string
 * field whose value is longer than 1KB with a placeholder. Used to keep the
 * debug log in the `complete` event small — tool-result media parts store
 * their base64 in a `data` field, and we don't want megabytes of it in the
 * NDJSON payload. The real screenshots are emitted as composed_page events
 * and saved separately by run.sh.
 */
export function truncateImages<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value), (key, v) => {
    if (key === 'data' && typeof v === 'string' && v.length > 1000) {
      return `[truncated ${Math.round(v.length / 1024)}kb — see screenshots]`;
    }
    return v;
  });
}

/**
 * Shape a reviewer/orchestrator tool's response as a lead text block
 * followed by one (label, image) pair per viewport in the order
 * mobile → tablet → desktop. Matches what the Vercel AI SDK expects for
 * multi-modal tool output (`{ type: 'content', value: [parts...] }`).
 */
export function viewportScreenshotContent(
  leadText: string,
  images: Record<Viewport, string>
) {
  return {
    type: 'content',
    value: [
      { type: 'text', text: leadText },
      ...VIEWPORTS.flatMap((v) => [
        {
          type: 'text',
          text: `${v.charAt(0).toUpperCase() + v.slice(1)} (${
            VIEWPORT_DIMENSIONS[v].width
          }px wide):`,
        },
        {
          type: 'media',
          data: images[v],
          mediaType: 'image/jpeg' as const,
        },
      ]),
    ],
  };
}
