# Ideas

Things worth doing, with context.

---

## `px chat <brain>` — terminal chat interface

A built-in chat UI that works out of the box. `px chat <brain>` opens a terminal chat interface (or browser-based). Brain runs with a persistent conversation loop, messages flow through the signal system. The `.wait()` + webhook pattern and pause/resume + message injection (from `feature/pause-and-chat` branch) are the foundation.

Best demo of the framework's value. Makes Positronic accessible to people who want to "just chat with an AI" before building workflows. Could leverage gen-ui components for a browser-based version later.

---

## OAuth integration

Add OAuth as a first-class auth method (Google, GitHub). `px login` opens a browser, does the OAuth dance, backend issues JWT after verification. Keep SSH key auth as headless/CI option. Would dramatically simplify onboarding for non-technical users — no SSH key setup needed.

---

## MCP client integration

Add `.withMCPServer(url)` to the Brain DSL. MCP tools auto-discovered and available in agent steps. Could be per-brain or project-wide config. Massive capability expansion — any MCP server (file systems, databases, APIs, web browsing) becomes available to brains. The deterministic/non-deterministic step split means MCP tools are only available in agent steps, where they're explicitly declared and visible.

Could also expose Positronic itself as an MCP server (run brain, check status, list schedules) so other AI systems can orchestrate it.

---

## Meta-agent for building brains

A Positronic brain that helps build other Positronic brains. Understands the Brain DSL, scaffolds new brains from natural language descriptions, suggests step structures and state schemas, generates tests alongside definitions. Could be a CLI command: `px brain generate "a brain that monitors HN and summarizes top posts"`. Needs comprehensive docs/patterns as its knowledge base first.

---

## Safety and visibility tooling

`px brain audit <name>` — static analysis of brain definitions showing which steps have access to which tools, flagging dangerous tool access (file writes, API calls with side effects). Could also show in `px show --steps` and the watch UI.

Prompt injection mitigation: trace data flow through the brain's step graph, flag steps where external data flows into a step that has side-effect tools. The deterministic/non-deterministic step split is the key advantage — deterministic steps can't be prompt-injected, non-deterministic steps have explicitly declared tool access.

---

## Observability

Brain execution traces (like OpenTelemetry spans), token usage dashboards, cost estimation per brain run, error rate tracking. GovernorDO already tracks some rate limiting data that could feed into this.

---

## `px webhooks list` CLI command

The backend endpoint (`GET /webhooks`) and spec test (`webhooks.list()` in `packages/spec/src/api/webhooks.ts`) already exist. Just needs a CLI component wired up in `cli.ts`. Low effort, immediately useful — lets developers see their registered webhooks and URLs without digging through code.

---

## Full webhook integration flow spec

The current webhook specs (`webhooks.trigger`, `webhooks.ignore`) only test the webhook endpoint in isolation. They don't verify the actual lifecycle: brain starts → hits `.wait()` → pauses → webhook fires → brain resumes → brain completes. This is the spec that would actually catch regressions. Requires backends to provide a test brain that uses `.wait()` with webhooks (the cloudflare test-project already has one).

Tracked in the spec package: `packages/spec/src/api/webhooks.ts`

---

## Descriptive singleton Durable Object IDs

Singleton DOs use `idFromName('singleton')` everywhere. Change to descriptive names: `'monitor'`, `'schedule'`, etc. Pure clarity win, no functional change. Trivial but nice.

Files: `packages/cloudflare/src/brain-runner-do.ts`, `packages/cloudflare/src/api.ts`, and anywhere else that calls `idFromName('singleton')`.

---

## Component `propsSchema` Zod definitions

The gen-ui-components have TypeScript prop interfaces but no Zod schemas attached. Adding `propsSchema` to each component would enable LLMs to validate their own component usage and produce better error messages during `generateUI`. Low priority but clean — the `validate_template` tool could use these instead of inferring from YAML.

Components: `packages/gen-ui-components/src/components/*.tsx`

---

## Events per tool call during UI generation

Currently `generateUI` is a black box — you get placements out but can't observe the LLM's tool calls as they happen. Emitting events per tool call would give visibility into what the LLM is doing while building a page, useful for debugging slow or bad UI generation.

---

## CLI server.ts delegation to backend

The CLI's `server.ts` uses chokidar directly and calls `syncResources()`, `generateTypes()`, etc. itself. The `PositronicDevServer` interface should have `onResourceChange()` and `onBrainChange()` methods so the backend decides what to do when files change, not the CLI.

Only matters when adding a second backend (e.g., AWS). Premature until then, but the right refactor when the time comes. See `packages/cli/src/commands/server.ts` and `packages/spec/src/index.ts`.

---

## Better brain execution error messages

When a brain step fails, error messages are cryptic (e.g., "Cannot read properties of undefined") with no stack trace or context about which step failed. Should show: which step failed, expected vs actual data, and hints about common fixes.

---

## UI generation loop termination

`generateUI()` (`packages/core/src/ui/generate-ui.ts`) uses `toolChoice: 'auto'` and terminates when the LLM outputs text without calling a tool — implicit completion with no explicit "done" signal. This already broke once when the default `toolChoice` changed to `'required'`.

Fix: add a `submit_template` tool that signals completion, and require `validate_template` to pass before accepting. Makes termination explicit and robust.

---

---

# Todos & Loose Ends

Small fixes, renames, and cleanup that don't rise to the level of "ideas" but shouldn't be forgotten.

---

## Rename `notify` to `onPageCreated` on UI steps

The `notify` callback in `.ui()` config fires when the page is created. `onPageCreated` is clearer about what it does and when it fires.

---

## Schedule spec: validate returned brain matches identifier

In-code TODO at `packages/spec/src/api/schedules.ts:60` — the spec test accepts any valid response without checking that the returned brain matches the one requested.

---

## PAUSED transition for waiting brains

In-code TODO at `packages/core/src/dsl/brain-state-machine.ts:1042` — could add a PAUSED transition to allow pausing a brain that's waiting on a webhook. Requires queueing webhook responses like USER_MESSAGE signals.

---

## Dev server architectural improvements

In-code TODO at `packages/cloudflare/src/dev-server.ts:324-329` — 5 improvements: extract .positronic into template package, declarative wrangler config, template interpolation, pipeline-based setup, better separation of concerns.

---

## Stale branch cleanup

~15 local branches for merged features still exist: `feature/loops`, `feature/options`, `feature/webhooks`, `feature/signals`, `feature/ssh-keys`, `feature/current-user`, `feature/rate-limit`, `feature/brain-over`, `feature/tool-choice`, `feature/watch-accept-name-or-run-id`, `feature/webhooks-first-attempt`, `fix/monitor-do-inner-brain-status`, `refactor/brainName`. The `feature/pause-and-chat` branch has unmerged work relevant to `px chat`.
