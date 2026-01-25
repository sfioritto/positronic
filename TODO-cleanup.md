# Cleanup TODO - State Machine & Resume Refactor

Tracking cleanup tasks from the signals feature branch work.

## Architecture Overview

The codebase implements **Event Sourcing**:
- **Brain** = Definition (the workflow)
- **BrainRunner** = Write Model / Command Handler (generates events)
- **BrainStateMachine** = Read Model / Projection (reconstructs state from events)

Events are the source of truth. The machine can reconstruct any state by replaying events.

---

## To Investigate

### 1. BrainEventStream vs BrainStateMachine State Tracking

**Location:** `packages/core/src/dsl/execution/event-stream.ts`

**Observation:** `BrainEventStream` maintains `currentStepIndex` and `currentState`. `BrainStateMachine` also tracks `executionStack` and `stepIndex`.

**Current design is correct:**
- Runner (via EventStream) *drives* execution and feeds the Machine
- Machine *observes* and records what happened
- On resume, we extract state from Machine to configure Runner

**Verification needed:** As we add complex flow control (loops, jumps), ensure we don't duplicate "next step" logic in both Machine and Stream. Stream decides what happens next; Machine records what happened.

---

## Done

- [x] **`innerResumeContext` Nesting Pattern** - Reviewed, well-designed. Recursive data structure matches recursive brain execution. Each brain peels off one layer and passes the rest down.
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
