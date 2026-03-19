# Webhook Triggers: Start New Brains from Incoming Webhooks

**Status:** active
**Started:** 2026-03-18

## Goal

Enable webhooks to start fresh brain runs, not just resume existing ones. The motivating use case is external service integrations — e.g., a GitHub webhook that starts a "code-review" brain when a PR is created.

## Log

### Design discussion

The key insight was that the handler's return type is a natural discriminator. Existing webhooks return `{ type: 'webhook', identifier, response }` where the identifier matches a waiting brain. For triggers, the handler returns `{ type: 'trigger', response }` — no identifier because there's no brain to match.

We also added `{ type: 'ignore' }` for webhooks that receive multiple event types (e.g., GitHub sends PR opened, closed, edited to the same URL). Without this, handlers had to throw to ignore events, which returns 500 and can cause retries.

The trigger config lives on the webhook definition itself: `createWebhook(slug, schema, handler, { brain: 'code-review', runAs: 'webhook-bot' })`. This means only explicitly configured webhooks can start brains — no new attack surface.

### Security model

The user-written `handler(request)` runs first on every webhook hit. That's where GitHub HMAC signatures get validated, event types get filtered, etc. If the handler throws, nothing happens. The `triggers` config is checked second — a webhook without it that returns `type: 'trigger'` gets a 400. Two gates.

### Extracting `startBrainRun`

First pass duplicated the uuid + DO stub + start pattern a third time (it was already in brains.ts and schedule-do.ts). Code review caught this and we extracted `startBrainRun(namespace, brainTitle, currentUser, initialData)` into brain-runner-do.ts. All three call sites now use it.

The brain resolution logic (manifest.resolve) is NOT in the shared function — it stays in callers because each caller handles resolution errors differently (Hono JSON response vs thrown error vs ScheduleDO which doesn't resolve at all since it stores the title directly).

### Spec package

Initially forgot that the spec package exists to ensure new backends discover required features. Added `webhooks.trigger()` and `webhooks.ignore()` spec tests so any backend running the spec suite will see these fail and know they need to implement trigger support.

## Learnings

- The webhook manifest carries trigger config automatically because `createWebhook` attaches it as a property on the function object. The auto-generated `_webhookManifest.ts` just imports and re-exports the webhook — no manifest generation changes needed.

- The spec package pattern is important for backend-agnostic features. If you add behavior to the cloudflare package's webhook handler, you need a corresponding spec test or new backends will silently lack the feature.

- ScheduleDO still needs its own uuid import because it generates schedule IDs (not brain run IDs) with uuidv4 in `createSchedule()`. Can't fully eliminate the dependency there.

## Dead ends

None — the design discussion happened before implementation and the approach was straightforward. The only course correction was the code review feedback to extract the shared utility and fix a misleading test.

## Solution

Extended `WebhookHandlerResult` with two new variants (`trigger` and `ignore`), added `WebhookTriggerConfig` to `createWebhook`, and branched on the handler's return type in the webhook route handler. Trigger webhooks resolve the brain from the manifest and start a fresh `BrainRunnerDO` via the shared `startBrainRun` utility. All existing webhook behavior (resume, verification) is unchanged.
