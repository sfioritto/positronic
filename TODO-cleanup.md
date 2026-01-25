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

### 1. Delete `state-reconstruction.ts` (CLI)

**Location:** `packages/cli/src/utils/state-reconstruction.ts`

**Problem:** Manual utility `reconstructStateAtEvent` iterates over events and applies patches with `fast-json-patch`. This duplicates exactly what `BrainStateMachine` does. If the machine changes how it handles state (e.g., new event types), this utility will break silently.

**Fix:** Delete the file. In `Watch.tsx` and other CLI components that need state at a point in time:
```typescript
// Instead of:
// const state = reconstructStateAtEvent(events, index);

// Do this:
const machine = createBrainExecutionMachine();
for (const event of events.slice(0, index + 1)) {
  sendEvent(machine, event);
}
const state = machine.context.currentState;
```

**Files to update:**
- Delete `packages/cli/src/utils/state-reconstruction.ts`
- Update `packages/cli/src/components/Watch.tsx` (or wherever it's used)
- Update/delete `packages/cli/tests/state-reconstruction.test.ts`

---

### 2. Simplify `MonitorDO` Event Processing (O(N²) → O(1))

**Location:** `packages/cloudflare/src/monitor-do.ts`

**Problem:** In `handleBrainEvent`, for every new event:
```typescript
const storedEvents = this.storage.exec(...).toArray(); // Fetch ALL history
const machine = createBrainExecutionMachine({ events: storedEvents }); // Replay ALL history
const { status } = machine.context;
```
This replays the *entire* history for every event just to get the current status. For long-running agents, this is O(N²) over the life of the run.

**Fix:** Durable Objects stay alive - keep the machine instance in memory:
1. Store `private machine: BrainStateMachine` on the class
2. In `handleBrainEvent`, just call `sendEvent(this.machine, event)` - O(1)
3. Only fetch/replay history in the constructor (or `blockConcurrencyWhile`) when the DO first wakes up (hydration)

**Benefit:** Status lookups become instant. No SQL queries or replay needed for each event.

---

### 3. Abstract the "Event Store" Pattern

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

### 4. `innerResumeContext` Nesting Pattern

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

### 5. `findWebhookResponseInResumeContext` in event-stream.ts

**Location:** `packages/core/src/dsl/execution/event-stream.ts`

**Problem:** Searches through resumeContext tree to find webhookResponse at deepest level. This is a symptom of the nested tree structure.

**Possible fixes:**
- If we simplify innerResumeContext pattern (#4), this might become trivial
- Could use `machine.context.isWaiting` to know if resuming from webhook
- Or add `webhookResponse` to machine context directly

---

### 6. BrainEventStream vs BrainStateMachine State Tracking

**Location:** `packages/core/src/dsl/execution/event-stream.ts`

**Observation:** `BrainEventStream` maintains `currentStepIndex` and `currentState`. `BrainStateMachine` also tracks `executionStack` and `stepIndex`.

**Current design is correct:**
- Runner (via EventStream) *drives* execution and feeds the Machine
- Machine *observes* and records what happened
- On resume, we extract state from Machine to configure Runner

**Verification needed:** As we add complex flow control (loops, jumps), ensure we don't duplicate "next step" logic in both Machine and Stream. Stream decides what happens next; Machine records what happened.

---

## Done

- [x] **`readSseStream` test utility** - Already uses state machine correctly
- [x] **Move `executionStackToResumeContext` into BrainRunner**
  - Now private to BrainRunner
  - External consumers just pass `machine` + `webhookResponse` to `resume()`
  - ResumeContext is an internal implementation detail
- [x] **Fix nested brain webhook resume** - Inner brain state was using wrong base for patches
- [x] **State machine stepIndex increment** - completeStep now increments stepIndex
- [x] **Don't emit START on resume** - Event stream emits WEBHOOK_RESPONSE instead
