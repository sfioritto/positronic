# Dev server origin per port, governor model defaults

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 684e1d33 (origin), 226309ad (governor)

## Goal

Two loose ends from the json-render work. The dev server wrote `http://localhost:8787` to R2 as the page origin no matter which `--port` it was started on, so form submissions from generated pages only worked on the default port. And the governor only knew Google rate limits for a handful of Gemini ids, so `gemini-flash-latest` (the new template default) logged "no rate limits known" and ran unthrottled.

## Log

### Origin

The origin was written in `setup()`, which doesn't know the port; `start(port)` does. Moving the write into `start()` fixes it with no interface change. `deploy()` still calls `setup()` and writes the production origin itself after wrangler prints the workers.dev URL, so nothing there changes.

### Governor defaults

Looked up the current published limits for all three providers:

- **Anthropic** publishes a table by tier and model family (Start tier: Fable 1,000 RPM / 500K input TPM, everything else 1,000 RPM / 2M). Model ids are dateless from the 4.6 generation on; older ones carry a date suffix.
- **OpenAI** publishes per-model rate limits on each model page, not on the rate-limits guide. Tier 1 is 500 RPM for nearly everything; TPM ranges from 30K (gpt-4o, gpt-4.1, o3) to 500K (gpt-5 line). Variants like `gpt-5.6-sol/terra/luna` share Tier 1 limits with `gpt-5.6`.
- **Google** no longer publishes per-model RPM/TPM at all. The rate-limits page now describes spend-based limits ("$10 per 10 minutes" at Tier 1) and points to AI Studio for a project's live numbers. Third-party tables all stop at the 2.5 family. So the Google rows keep the last published Tier 1 figures per family, and the new 3.x flash models and `-latest` aliases inherit them.

Anthropic and OpenAI already send rate-limit headers, which the governor picks up after the first response. The defaults matter for the first burst: a `.map()` fanning out 50 prompts before any header comes back is exactly the case the governor exists for.

### Matching by family

Exact-match lookup can't keep up with dated snapshots and previews (`claude-sonnet-4-5-20250929`, `gemini-3.1-pro-preview`). Switched to exact match, then longest key the id extends with a `-`. The `-` boundary matters: `gpt-5.1` must not resolve to `gpt-5`, and `gpt-5-nano-2025-08-07` must pick `gpt-5-nano` over `gpt-5` (they differ in TPM). One consequence: `gemini-2.5-pro-002` now resolves to the 2.5 Pro row where the old test asserted null. That was a deliberate flip.

## Learnings

- The governor DO is keyed by identity, and once any model seeds its limits (`limitsLoaded`) later models on the same identity reuse them. Mixing models under one identity gets the first model's limits. Not changed here, worth remembering.
- Google's published ids differ from what the old table had (`gemini-2.0-flash`, not `gemini-2-flash`; `gemini-3-flash-preview`, not `gemini-3-flash`). Family matching papers over the preview suffix but the 2.0 spelling was simply wrong.

## Solution

Origin write moved from `setup()` to `start(port)`, no interface change. Governor defaults became a three-provider table with exact-then-longest-family lookup; header-reporting providers still override it after the first response, Google relies on it entirely.
