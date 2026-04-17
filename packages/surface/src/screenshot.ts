/**
 * Take a screenshot of an HTML page using Cloudflare Browser Rendering REST API.
 *
 * Returns the PNG as a Uint8Array.
 */
export async function screenshot(params: {
  html: string;
  accountId: string;
  apiToken: string;
  viewport?: { width: number; height: number };
}): Promise<Uint8Array> {
  const { html, accountId, apiToken, viewport } = params;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html,
        viewport: viewport ?? { width: 1280, height: 720 },
        gotoOptions: {
          waitUntil: 'networkidle0',
        },
        // Wait until mount.tsx has flipped body[data-rendered] after React
        // finishes rendering. Without this, fullPage measures the viewport-
        // sized document before React expands it and clips the capture.
        waitForSelector: {
          selector: 'body[data-rendered="true"]',
        },
        screenshotOptions: {
          fullPage: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Browser Rendering screenshot failed (${response.status}): ${text}`
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

export type Viewport = 'mobile' | 'tablet' | 'desktop';

export const VIEWPORTS: readonly Viewport[] = ['mobile', 'tablet', 'desktop'];

/**
 * Viewport dimensions used for multi-device screenshot capture. Widths match
 * common device breakpoints; heights are only relevant before fullPage
 * expands the capture, so we pick standard portrait values.
 */
export const VIEWPORT_DIMENSIONS: Record<
  Viewport,
  { width: number; height: number }
> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

/**
 * Take the same page at all three viewports in parallel. Returns a keyed
 * object mapping viewport name to PNG bytes. Used by the preview tool so
 * the reviewer can evaluate responsive layout breakage, not just desktop.
 */
export async function screenshotAllViewports(params: {
  html: string;
  accountId: string;
  apiToken: string;
}): Promise<Record<Viewport, Uint8Array>> {
  const { html, accountId, apiToken } = params;

  const entries = await Promise.all(
    VIEWPORTS.map(async (viewport) => {
      const png = await screenshot({
        html,
        accountId,
        apiToken,
        viewport: VIEWPORT_DIMENSIONS[viewport],
      });
      return [viewport, png] as const;
    })
  );

  return Object.fromEntries(entries) as Record<Viewport, Uint8Array>;
}
