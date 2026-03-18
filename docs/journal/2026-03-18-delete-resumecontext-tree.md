# Delete ResumeContext tree type — flatten resume params

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

BrainEventStream tracked its own execution state (`currentState`, `currentStepIndex`, `resumeContext`) redundantly alongside BrainStateMachine. On resume, `BrainRunner.resume()` extracted state from the machine's flat context, converted it into a nested `ResumeContext` tree via `executionStackToResumeContext()`, then passed it to `Brain.run()` → `BrainEventStream`, which cloned the tree back into flat fields. The round-trip through a recursive tree type was pure redundancy.

Goal: delete `ResumeContext` and `executionStackToResumeContext()`. The stream receives flat resume values directly from the machine's context. No intermediate tree conversion.

## Log

### Initial implementation

Replaced `ResumeContext` (recursive tree) with 7 flat fields on `ResumeRunParams`. Worked, but code review correctly identified the "data clump" problem — 7 fields that always travel together spread across every interface and call site.

### Container type refactor

Grouped the 7 fields into `ResumeParams` — a flat (non-recursive) container. `ResumeRunParams` now has `resume: ResumeParams` instead of 7 top-level fields. Event-stream stores `private resume?: ResumeParams` instead of 5 separate fields. Clearing becomes `this.resume = undefined` everywhere.

### Key design decisions

1. **No `isDeepest` filtering.** Context fields (agentContext, iterateProgress, currentPage, webhookResponse) flow through unconditionally. Each nesting level forwards its `resume` to the inner brain and clears `this.resume`. The deepest level consumes the fields naturally. This handles arbitrary nesting depth correctly — the original `isDeepest` check would silently drop context at 3+ levels.

2. **`Omit<IterateContext, 'stepId'>` for `iterateProgress`.** The `stepId` is a state machine internal that resume consumers don't need.

## Learnings

- The `ResumeContext` tree was only ever constructed in one place and destructured in one place. When a data structure is built and torn apart in exactly two places, it might not need to exist.
- First attempt spread 7 loose fields everywhere — replacing one problem (recursive tree) with another (data clump). The container type gives the same structural improvement without the spreading.
- "Only pass to deepest level" logic was a translation artifact from the tree structure. Forwarding + clearing handles arbitrary depth without thinking about it.
- `AgentResumeContext` was exported from `@positronic/core` but never imported anywhere — dead code.

## Dead ends

- **7 loose fields on ResumeRunParams.** Worked but was a data clump worse than the tree it replaced. Immediately refactored to the `ResumeParams` container.

## Solution

New `ResumeParams` flat container type. `ResumeRunParams.resume: ResumeParams` is the single field. Event-stream stores one `private resume?: ResumeParams`. Inner brain forwarding: build a new `ResumeParams` from the current one's `innerStack`, pass all context fields through, then `this.resume = undefined`. Deleted `ResumeContext`, `AgentResumeContext`, `executionStackToResumeContext()`, `findWebhookResponseInResumeContext()`, and `agent-messages.ts`.
