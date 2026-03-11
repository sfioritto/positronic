# Positronic Roadmap & Ideas

_Last updated: 2026-03-10_

This document captures the full landscape of where Positronic is, what's pending, and where it could go. It combines existing TODOs, design doc loose ends, and new ideas.

---

## Current State (v0.0.74)

Positronic is a production-capable framework with:

- **Brain DSL**: Steps, prompts, agents, guards, wait/webhooks, UI generation, nested brains, batch processing
- **Store**: Typed key-value storage with Zod schemas, per-user and shared scoping, CLI explorer (`px store`)
- **Memory**: Mem0 integration with automatic user/brain scoping (no manual userId threading)
- **Auth**: JWT-based with SSH keys, name-based user IDs, automated root key setup on project creation, top-level `px login`/`px logout`/`px whoami` commands
- **Rate Limiting**: GovernorDO with queue-based leaky bucket (RPM/TPM)
- **Scheduling**: Cron-based with timezone support, runs execute as the user who created them
- **CLI**: 40+ commands across project, brain, resource, schedule, secret, page, user, store, and server management
- **Clients**: Anthropic (Claude) and Vercel AI SDK (model-agnostic)
- **Gen UI**: 12 React components, YAML-based generation, form webhooks with CSRF
- **Backend**: Cloudflare Workers + Durable Objects + R2 (origin URL centralized via R2 config key)
- **Developer Journal**: Claude Code skill for capturing design decisions and learnings

---

## 1. Auth & User Experience Overhaul

### What's Done (v0.0.74)

- **Automated root key setup**: `px project new` discovers/generates SSH keys, converts to JWK, writes `ROOT_PUBLIC_KEY` to `.env` automatically — no manual key formatting
- **Name-based user IDs**: Dropped UUIDs — username is the primary key everywhere (AuthDO, API, CLI)
- **Consolidated CLI commands**: Deleted the `px auth` namespace entirely. `px login`/`px logout`/`px whoami` are top-level. `px users keys *` flattened to `px users add-key/remove-key/list-keys`
- **Interactive key pasting**: `px users add-key <name> --paste` for when you don't have a file path
- **Onboarding guidance**: Project creation now tells users to set their API key and points to `runner.ts` for provider switching

### Remaining Ideas

**OAuth Integration**
- Add OAuth as a first-class auth method (Google, GitHub, etc.)
- `px login` could open a browser, do the OAuth dance, store tokens locally
- Backend issues JWT after OAuth verification
- This would make onboarding dramatically simpler — no SSH keys needed for most users
- Keep SSH key auth as a "headless/CI" option

---

## 2. First-Class Chat Interface

### The Vision

A built-in chat UI that works out of the box when you start a Positronic project. Not just a demo — a real, useful interface for interacting with brains.

### What This Could Look Like

- `px chat <brain>` opens a terminal chat interface (or browser-based)
- Brain runs with a persistent conversation loop
- Messages flow through webhooks or the signal system
- The `.wait()` + webhook pattern already supports this — chat is just a specific application of it
- Could leverage the existing gen-ui component system for a browser-based version
- Persistent webhooks (from the "Good Idea Fairies" section of webhook-design.md) would be the ideal underlying mechanism

### Why It Matters

- Instantly demonstrates what Positronic can do
- Provides a reference implementation for the most common AI app pattern
- Makes the framework accessible to people who want to "just chat with an AI" before building workflows

---

## 3. Positronic Agent for Building Positronic Agents

### The Idea

A meta-agent: a Positronic brain that helps you build other Positronic brains. It would:

- Understand the Brain DSL deeply (from docs + code)
- Scaffold new brains based on natural language descriptions
- Suggest step structures, tool configurations, state schemas
- Generate test files alongside brain definitions
- Know about common patterns (API fetching, classification, form generation)

### Implementation Approach

- Could be a built-in brain shipped with the template project
- Or a CLI command: `px brain generate "a brain that monitors HN and summarizes top posts"`
- Would use the existing agent step with tools for file creation
- Needs comprehensive documentation as its knowledge base (see Section 5)

### Connection to Existing Work

- TODO.md Section 2 documents exactly the pain points an AI agent hit when trying to create a brain
- The "Process Documentation" action item (`Create a process guide for generating brains`) feeds directly into this
- The template project's `tips-for-agents.md` is a start but needs to be much more comprehensive

---

## 4. MCP Server Integration

### Current State

Zero MCP integration exists in the codebase today.

### The Opportunity

MCP (Model Context Protocol) lets you attach external tool servers to AI agents. For Positronic this means:

- **Brain steps could call MCP tools** — any MCP server becomes available as tools in agent steps
- **Positronic itself could be an MCP server** — expose brain execution, state querying, scheduling as MCP tools that other AI systems can call
- **Open source MCP servers** provide instant capabilities: file systems, databases, APIs, web browsing, code execution

### Implementation Ideas

**As MCP Client (brains use MCP tools)**
- Add `.withMCPServer(url)` to the Brain DSL
- MCP tools auto-discovered and available in agent steps
- Could be per-brain or project-wide configuration

**As MCP Server (Positronic exposes its API)**
- Wrap the existing API endpoints as MCP tools
- "Run brain X with these options", "Check status of run Y", "List schedules"
- Other AI systems (Claude Desktop, Cursor, etc.) could orchestrate Positronic

### Connection to the Vision

This is how Positronic becomes a **platform for AI developers**. The deterministic/non-deterministic step split means MCP tools are only available in agent steps, where they're explicitly declared and visible.

---

## 5. Documentation Strategy — Mostly for Robots, Some for Humans

### Current Docs Assessment

**Strong areas:**
- Technical design docs (webhook-design.md, ui-step-design.md)
- Testing guides (philosophy, CLI testing, core testing)
- Command creation guide
- Agent tips (tips-for-agents.md in template)

**Gaps:**
- No getting-started tutorial or quickstart
- No "common patterns" cookbook (explicitly called out in TODO.md)
- No deployment guide
- No CLI command reference
- No error reference / troubleshooting guide
- Incomplete webhook docs (cold-start, loop integration still PLANNED)
- No real-world example brains beyond snippets

### The "Mostly for Robots" Angle

If the primary "developer" using Positronic is an AI agent (Claude Code, Cursor, etc.), then docs should optimize for:

- **Exhaustive API reference** — every method, every parameter, every return type
- **Complete examples** — not snippets, but full working brains with tests
- **Decision trees** — "if you want X, use Y" flowcharts that an agent can follow
- **Error catalogs** — every error message mapped to its cause and fix
- **Pattern library** — reusable brain patterns with copy-paste templates

For humans, focus on:
- **Conceptual overview** — what is Positronic, why does it exist, what's the mental model
- **Quickstart** — 5 minutes to a running brain
- **Architecture guide** — how the pieces fit together

### Action Items from TODO.md (Still Pending)

- [ ] "Common Patterns" doc with examples (API fetching, AI classification, error handling, state management)
- [ ] Make `.prompt()` step docs more prominent
- [ ] Add type definitions / inline docs for step contexts
- [x] Include example brain in template project (example + hello brains with provider-switching docs)
- [ ] Create process guide for generating brains
- [ ] Improve error messages (which step failed, expected vs actual, hints)

---

## 6. Developer Journal Skill (Claude Code) — DONE

Implemented and active. The journal skill runs automatically during non-trivial work sessions, capturing design decisions, dead ends, and learnings in `docs/journal/`. Each effort gets its own dated file. Journal commits ride on top of HEAD and get shuffled around real commits via soft-reset.

See `.claude/skills/journal/SKILL.md` for the full protocol.

---

## 7. Safety & Visibility for Non-Deterministic Steps

### The Core Insight

Positronic's step model creates a natural boundary between what an AI can do (non-deterministic steps: `.prompt()`, `.brain()`) and what happens mechanically (deterministic steps: `.step()`, `.guard()`). This is a **safety advantage** over pure agent frameworks like OpenClaw where the agent has unlimited tool access.

### Concrete Ideas

**Tool Access Visualization**
- In the CLI (`px show --steps`), highlight which steps have access to which tools
- Color-code or flag "dangerous" tool access (file writes, API calls with side effects, email sending)
- Could show this in the watch UI too

**Tool Access Analysis**
- Static analysis at brain definition time
- "This agent step has access to `sendEmail` and `deleteRecord` — are you sure?"
- Could be a `px brain audit <name>` command
- Or automatic warnings during `px run`

**Sandboxing Recommendations**
- Based on tool definitions, recommend whether a step should be behind a `.guard()` or `.ui()` confirmation
- "Step 'ProcessEmails' can archive emails. Consider adding a confirmation UI step."

**Prompt Injection Mitigation**
- Non-deterministic steps only see tools explicitly declared
- Framework could analyze which tools process external data (webhooks, API responses) vs internal data
- Flag steps where external data flows into a step that has side-effect tools
- This is the "at the token level" insight — we can trace data flow through the brain's step graph

### Connection to the Platform Vision

This is the pitch for why Positronic is better than "just let the agent run":
- Deterministic steps can't be prompt-injected — they're just code
- Non-deterministic steps have explicitly declared, auditable tool access
- The `.ui()` step creates a human checkpoint for sensitive operations
- The brain graph is inspectable before execution

---

## 8. Existing TODOs & Loose Ends

### From TODO.md

**1. Refactor CLI server.ts — Reduce Orchestration Logic**
- Status: Not started
- The CLI's file watcher holds too much logic about what to do on changes
- Proposed: Add `onResourceChange()` and `onBrainChange()` to `PositronicDevServer` interface
- This matters for multi-backend support (if you ever add AWS, etc.)

**2. AI Agent Development Pain Points**
- Status: Partially addressed (docs improved, but action items remain)
- Remaining items listed in Section 5 above

**3. UI Generation Agentic Loop Design**
- Status: Not investigated
- The `generateUI()` loop termination is fragile (relies on LLM choosing not to call a tool)
- Questions: Should there be an explicit `done` tool? Should `validate_template` be required?

### From webhook-todo.md

| # | Task | Status | Priority |
|---|------|--------|----------|
| 1 | Remove `action` property from webhook responses | Pending | TBD |
| 2 | Add webhook integration specs to spec package | Pending | High |
| 3 | Rename `restart()` to `resume()` | Done | - |
| 4 | Reconsider webhook serialization approach | Pending | Low |
| 5 | Change singleton DO IDs to descriptive names | Pending | Low |

### From webhook-design.md — PLANNED Features

- **Cold-start brains from webhooks** — `type: 'start-brain'` return type not yet implemented
- **Loop integration with webhooks** — persistent webhooks, `LOOP_MESSAGE` events
- **Webhook timeouts** — configurable per-webhook (note: `.wait()` timeout exists, but webhook-level timeout doesn't)

### From plan.md — Component Bundle Refactoring

- Status: Unclear if implemented
- Goal: Move components from Runner to Brain, remove inline bundling, serve via `/bundle/` endpoint
- Several items may have been addressed in recent releases (`.withComponents()` on Brain exists)

### In-Code TODOs

| Location | Comment |
|----------|---------|
| `spec/src/api/schedules.ts:52` | Validate returned brain matches identifier |
| `core/src/dsl/brain-state-machine.ts:943` | Add PAUSED transition for waiting brains |
| `cloudflare/src/dev-server.ts:296` | 5 architectural improvements for .positronic setup |
| `core/tests/brain-options-schema.test.ts:96` | Verify state default values |

### Stale Branches

These local/remote branches may contain unmerged work worth reviewing:

- `feature/loops` — loop step is merged, but branch still exists
- `feature/options` — options support is merged
- `feature/pause-and-chat` — relevant to the chat interface idea
- `feature/rate-limit-advanced` — may have ideas beyond current GovernorDO
- `claude/plan-loop-step-HNAfQ` — Claude-generated branch, might have useful context

---

## 9. Other Ideas & Future Directions

### Loops (The DSL Primitive)

The `feature/loops` branch exists and the agent step (formerly "loop") is the current iteration. But there's still the question of whether a true `loop` primitive (repeat a sequence of steps N times or until a condition) would be valuable as a separate concept from agents.

### Multi-Backend Support

The `PositronicDevServer` interface exists for backend abstraction, but only Cloudflare is implemented. The server.ts refactoring (TODO #1) is a prerequisite for clean multi-backend support. Potential backends:
- AWS Lambda + DynamoDB + S3
- Fly.io
- Local/Docker for development

### Observability & Monitoring

- Brain execution traces (like OpenTelemetry spans)
- Token usage dashboards
- Cost estimation per brain run
- Error rate tracking
- The GovernorDO already tracks some of this

### Version Control for Brain State

- Ability to snapshot and restore brain store state
- Migration system for store schema changes
- "Time travel" debugging — replay brain execution from any point

### Marketplace / Registry

- Share brain definitions as packages
- Publish webhook handlers for common services (Slack, GitHub, Stripe)
- Component libraries for gen-ui beyond the built-in set

---

## Priority Assessment

If I had to rank these by impact and readiness:

### Recently Completed
- ~~**Auth UX cleanup**~~ — Done (v0.0.74): automated root key, name-based IDs, consolidated CLI
- ~~**Developer journal skill**~~ — Done: active and in use

### Do Soon (foundation for everything else)
1. **Docs overhaul** — unblock AI agent development
2. **Webhook integration specs** — already designed, just needs implementation
3. **OAuth integration** — remaining auth work, would dramatically simplify onboarding for non-technical users

### Do Next (multiplier effects)
4. **MCP client integration** — massive capability expansion with relatively contained scope
5. **Chat interface** — best demo of the framework's value

### Do When Ready (vision items)
6. **Positronic meta-agent** — needs docs + patterns first
7. **Safety/visibility tooling** — differentiator, but needs real users to validate
8. **Cold-start webhooks** — designed but not yet needed

### Keep in Mind (background items)
9. **CLI server.ts refactoring** — only matters when adding another backend
10. **UI generation loop redesign** — works well enough for now
11. **Component bundle refactoring** — check what's already done vs. what remains
