import type { Spec } from '@json-render/core';
import { escapeHtml } from '../template/render-html.js';

/**
 * Generate a CSRF token for form submissions.
 * Use this when building custom HTML pages with forms that submit to webhook endpoints.
 *
 * Include the returned token as a query parameter in the form action URL:
 * ```
 * /webhooks/system/page-form?identifier=...&token=${token}
 * ```
 * And include it in the WebhookRegistration's `token` field.
 */
export function generateFormToken(): string {
  return crypto.randomUUID();
}

export interface GeneratePageHtmlOptions {
  /** The json-render spec, with `state` already seeded from the step's props */
  spec: Spec;
  /** Page title */
  title?: string;
  /** URL the page's submitForm action POSTs to (token included as a query param) */
  formAction?: string;
}

// Serialize for embedding in a script tag: a `</script>` inside the data
// must not end the script element.
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Generate the HTML document for a generated page.
 *
 * The document embeds the spec as `window.__POSITRONIC_PAGE__` and loads the
 * project's component bundle (`/bundle/components.js` and `.css`), which
 * renders the spec into `#root` and handles form submission.
 */
export function generatePageHtml(options: GeneratePageHtmlOptions): string {
  const { spec, title = 'Generated Page', formAction } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/bundle/components.css">
</head>
<body>
  <div id="root"></div>
  <script>
    window.__POSITRONIC_PAGE__ = ${safeJsonStringify({ title, spec, formAction: formAction ?? null })};
  </script>
  <script src="/bundle/components.js"></script>
</body>
</html>`;
}
