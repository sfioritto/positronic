# Agent System Removal

**Status:** shipped
**Started:** 2026-03-21
**Shipped:** 2026-03-21

## Goal

Remove the entire agent system (LLM tool-calling loop via `.brain()` overloads) to make way for a new "prompt+loop" approach. The agent system was deeply integrated — 11 event types, a dedicated state machine state (`agentLoop`), resume/pause context, tool merging, CLI viewers — all of it needed to go cleanly.

A comprehensive reference doc was written first (`docs/removed-agent-system.md`) so the new approach can reference how things worked without reading git diffs.

## Log

### Planning

Mapped the full agent surface area before writing any code. The system touched every layer: types, constants, events, blocks, execution (the ~600-line `executeAgent()` method), state machine, DSL builder, `createBrain()`, CLI components, memory adapter, spec tests, cloudflare backend signals, and the test-project.

Key scoping decisions from discussion with the user:

- **Keep nested brains** — `.brain()` still works for running an inner Brain instance as a step
- **Keep webhooks** — used for many non-agent things
- **Keep tools module** — `createTool`, `generatePage`, `waitForWebhook`, `print`, `consoleLog`, `defaultTools` will be reused by the replacement
- **Keep client implementations** — `generateText`, `createToolResultMessage`, `streamText` all stay on ObjectGenerator
- **Remove `USER_MESSAGE` signal** — agent-only, will be re-added with a fresh design for prompt+loop
- **Rename `AgentTool` → `Tool`, `AgentToolWaitFor` → `ToolWaitFor`** — clean break from agent naming since these types carry forward
- **Remove `AgentConfig`, `AgentConfigWithOutput`** — the prompt+loop system will have its own config shape

### Execution

Worked bottom-up: types/constants first, then execution layer, then DSL, then CLI, then tests. Used parallel agents for the large file edits (event-stream.ts, brain-state-machine.ts, brain.ts builder, CLI components).

The spec package (`@positronic/spec`) was a surprise — wasn't in the original plan but had `watchAgentEvents` and `agentWebhookResume` spec test methods that referenced removed AGENT\_\* constants.

The cloudflare test-project's `api.test.ts` had a large "Agent Webhook Resumption" describe block that needed removal. Also caught `AgentStartEvent` and other agent event type imports.

The mem0 integration test was almost entirely agent-dependent — tests used `.brain()` with agent config to test memory tool integration. Kept only `createMem0Tools` and the "empty buffer" test.

## Learnings

- **The spec package is easy to forget** — it's not "cloudflare" or "core" but it imports from core and has its own build. The error messages say `src/api/brains.ts` without the package name, which is confusing when both spec and cloudflare have files with that path.

- **`totalTokens` was tracked on BrainExecutionContext** — removing it from the state machine meant the CLI's EventsView still expected it as a prop. Simple fix (pass 0) since it was always agent-scoped anyway.

- **The `include: ["**/_"]`pattern in tsconfig can be misleading** — cloudflare's tsconfig excludes`test-project`but uses`\*\*/_`which looks like it includes everything. When build errors reference`src/api/brains.ts`, you have to check which package's tsconfig is reporting it.

## Solution

Removed all agent-related code across ~30 files. Kept the tool type system (renamed `AgentTool` → `Tool`), client interface methods (`generateText`, `streamText`), and the tools module for reuse by the replacement system. Reference doc at `docs/removed-agent-system.md` captures the full design for future reference.
