# Webhook Consolidation + HTML JSX Pages

**Status:** active
**Started:** 2026-03-26

## Goal

Eliminate the `src/webhooks/` directory entirely by consolidating two patterns that currently require manual webhook wiring:

1. **Page form submissions** — brains like email-digest and mercury-receipts manually create HTML pages, define custom webhooks, use `.wait()` + `.handle()` to process form data. This duplicates what `.page()` already does for LLM-generated pages (CSRF, suspension, state merging). Fix: let `.page()` accept custom HTML via JSX.

2. **Service protocol webhooks** — the Slack webhook understands Slack's Events API but lives in a flat `src/webhooks/` directory. Fix: move into the slack plugin via a new `webhooks` property on plugins.

The deeper motivation: the user realized that the form-parsing webhooks (archive, mercury-receipts) are pure boilerplate — they just parse form fields and route by sessionId, which is exactly what the built-in page-form system already handles. And service webhooks belong with their service plugin, not in a separate directory.

## Log

### Design discussion

Key design decisions from the planning phase:

**Why JSX for pages?** The custom HTML pages (unified-page.ts, confirmation-page.ts) are 500-800 lines of template literal HTML with manual `escapeHtml()` everywhere. JSX makes this dramatically better. But the existing positronic JSX runtime only handles prompt templates (Fragment, File, Resource), not HTML elements.

**One JSX runtime, not two.** We considered using Hono or Preact for HTML rendering and keeping positronic JSX for prompts. But that means two jsxImportSources, and you can't mix them in one file. Instead: extend the positronic runtime to accept HTML intrinsic elements, borrow type definitions from `@types/react` (already a devDependency), and add a separate `renderHtml()` renderer. Same JSX tree type, different renderers for different contexts.

**Page/Form as built-in components.** Rather than exposing `formAction` to brain authors, `<Form>` is a Symbol-based built-in (like `<File>` and `<Resource>`) that the HTML renderer recognizes and injects the form action URL into automatically. `<Page>` wraps content in HTML document boilerplate.

**Plugin webhooks: static + runtime.** Webhooks go on both `PluginDefinition` (for manifest discovery at startup without calling `create()`) and `PluginCreateReturn` (for brain context access as `slack.webhooks.x`). The manifest generator collects them from plugins alongside file-based webhooks.

**Pre-built tools with webhook waiting.** The slack plugin can ship a `slackWaitForReply` tool that internally returns `{ waitFor: slackWebhook(threadTs) }`. This means brains using prompt loops can just spread `...slack.tools` and get webhook-based waiting for free, without knowing about webhooks at all.

### Framework implementation (Phases 1-3)

All framework changes shipped in three commits. No issues during implementation except:

- **`Page` type name collision.** The `Page` interface from `dsl/pages.ts` (page metadata record) conflicted with the new `Page` symbol for the `<Page>` JSX component. Renamed the type export to `PageRecord`. Only one consumer in the cloudflare package needed updating.

- **WEBHOOK events don't stop the generate loop.** In unit tests without a signal provider, the brain event stream continues past WEBHOOK events and emits COMPLETE. The existing LLM page tests just didn't assert on COMPLETE being absent. The WEBHOOK event is a signal to the _backend_ to suspend, not a hard stop in the event stream. Adjusted the html page tests to match this behavior.

- **Page step validation errors propagate as exceptions**, not ERROR events. The `executePageStep` is called via `yield*` with no try/catch in the caller. This differs from step action errors which are caught and emitted as ERROR events. Both behaviors are correct for their context — step action errors are user code (catch and report), validation errors are framework bugs (throw fast).

## Learnings

- `.page()` with `formSchema` already generates a complete webhook system: unique identifier, CSRF token, formAction URL, suspension, resume, state merging. The custom page webhooks were reimplementing all of this.
- The `src/webhooks/` directory scan in dev-server.ts generates a manifest at build time. Plugin webhooks need to be merged into this manifest at runtime via `collectPluginWebhooks()`.
- `@types/react` is already a devDependency of @positronic/core, so we can borrow `JSX.IntrinsicElements` without adding new dependencies.
- Slack's Events API sends all events to one URL — you can't split webhook handlers per event type. So the slack webhook stays as one webhook with one slug.
- `TemplateNode.type` was narrowly typed to `BuiltinComponent | FunctionComponent`. Widening to include `string` for HTML tag names required a new `ElementType` union. The prompt renderer needed a guard to throw on string types, since HTML elements in prompt templates would silently produce garbage.
- `renderHtml()` is deliberately sync-only. Async components (which prompt templates support for `<File>` and `<Resource>`) throw immediately. This keeps HTML rendering fast and forces data loading into preceding `.step()` calls.

## Dead ends

None — the implementation went smoothly. The design discussion covered the alternatives thoroughly before writing code.
