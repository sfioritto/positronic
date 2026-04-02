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
