# Cleanup TODO - State Machine & Resume Refactor

Tracking cleanup tasks from the signals feature branch work.

## In Progress

(none currently)

## To Investigate

- [ ] **`innerResumeContext` nesting pattern**
  - Currently converting flat `executionStack` array into nested `ResumeContext` tree
  - Then event stream traverses the tree via `innerResumeContext`
  - Could the event stream just read from `executionStack[depth]` directly?
  - Seems like unnecessary complexity

- [ ] **`findWebhookResponseInResumeContext` in event-stream.ts**
  - Searches through resumeContext tree to find webhookResponse
  - Could potentially use `machine.context.isWaiting` instead
  - Or if we simplify innerResumeContext, this might become trivial

## Done

- [x] **`readSseStream` test utility** - Already uses state machine correctly
- [x] **Move `executionStackToResumeContext` into BrainRunner**
  - Now private to BrainRunner
  - External consumers just pass `machine` + `webhookResponse` to `resume()`
  - ResumeContext is an internal implementation detail
