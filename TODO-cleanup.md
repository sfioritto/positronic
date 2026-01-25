# Cleanup TODO - State Machine & Resume Refactor

Tracking cleanup tasks from the signals feature branch work.

## Architecture Overview

The codebase implements **Event Sourcing**:
- **Brain** = Definition (the workflow)
- **BrainRunner** = Write Model / Command Handler (generates events)
- **BrainStateMachine** = Read Model / Projection (reconstructs state from events)

Events are the source of truth. The machine can reconstruct any state by replaying events.

---

## High Priority

### 1. Abstract the "Event Store" Pattern

**Location:** `packages/cloudflare/src/brain-runner-do.ts`

**Problem:** Raw SQL queries for fetching events are hardcoded:
```typescript
this.sql.exec(`SELECT serialized_event FROM brain_events...`)
```
This couples the Runner to SQLite. The `BrainRunSQLiteAdapter` handles writing, but reading is hardcoded.

**Fix:** Create an `EventStore` interface in `@positronic/core`:
```typescript
interface EventStore {
  getEvents(brainRunId: string): Promise<BrainEvent[]>;
  // Maybe: getEventsSince(brainRunId: string, afterEventId: string): Promise<BrainEvent[]>;
}
```
- `BrainRunnerDO` uses this interface to get events for resume
- Aligns with event sourcing: Runner just needs events, doesn't care about storage

**Benefit:** Could swap SQLite for JSON files (CLI), Postgres, etc. without changing Runner logic.

---

## To Investigate

### 2. `innerResumeContext` Nesting Pattern

**Location:** `packages/core/src/dsl/brain-runner.ts` (executionStackToResumeContext)

**Question:** We convert flat `executionStack` array into nested `ResumeContext` tree, then the event stream traverses via `innerResumeContext`. Could the event stream just read from `executionStack[depth]` directly?

**Current flow:**
```
executionStack: [{ state, stepIndex }, { state, stepIndex }]  // flat
    ↓ executionStackToResumeContext()
ResumeContext: { state, stepIndex, innerResumeContext: { state, stepIndex } }  // nested tree
    ↓ event-stream traverses via innerResumeContext
```

**Potential simplification:** Pass machine to event stream, let it read `executionStack[depth]` based on current depth.

---

### 3. `findWebhookResponseInResumeContext` in event-stream.ts

**Location:** `packages/core/src/dsl/execution/event-stream.ts`

**Problem:** Searches through resumeContext tree to find webhookResponse at deepest level. This is a symptom of the nested tree structure.

**Possible fixes:**
- If we simplify innerResumeContext pattern (#2), this might become trivial
- Could use `machine.context.isWaiting` to know if resuming from webhook
- Or add `webhookResponse` to machine context directly

---

### 4. BrainEventStream vs BrainStateMachine State Tracking

**Location:** `packages/core/src/dsl/execution/event-stream.ts`

**Observation:** `BrainEventStream` maintains `currentStepIndex` and `currentState`. `BrainStateMachine` also tracks `executionStack` and `stepIndex`.

**Current design is correct:**
- Runner (via EventStream) *drives* execution and feeds the Machine
- Machine *observes* and records what happened
- On resume, we extract state from Machine to configure Runner

**Verification needed:** As we add complex flow control (loops, jumps), ensure we don't duplicate "next step" logic in both Machine and Stream. Stream decides what happens next; Machine records what happened.

---

## Done

- [x] **Simplify `MonitorDO` Event Processing (O(N²) → O(1))**
  - Keep state machines in memory via `Map<string, BrainStateMachine>`
  - Only hydrate from stored events when DO wakes from hibernation
  - Clean up machines on terminal status to free memory
- [x] **Delete `state-reconstruction.ts` (CLI)**
  - Deleted `packages/cli/src/utils/state-reconstruction.ts` and its tests
  - `watch.tsx` now uses `createBrainExecutionMachine` + `sendEvent` to reconstruct state
  - Moved `StoredEvent` type to `events-view.tsx`
- [x] **`readSseStream` test utility** - Already uses state machine correctly
- [x] **Move `executionStackToResumeContext` into BrainRunner**
  - Now private to BrainRunner
  - External consumers just pass `machine` + `webhookResponse` to `resume()`
  - ResumeContext is an internal implementation detail
- [x] **Fix nested brain webhook resume** - Inner brain state was using wrong base for patches
- [x] **State machine stepIndex increment** - completeStep now increments stepIndex
- [x] **Don't emit START on resume** - Event stream emits WEBHOOK_RESPONSE instead
