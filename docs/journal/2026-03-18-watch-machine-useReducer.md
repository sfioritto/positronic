# Replace watch-machine.ts robot3 with useReducer

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

The `watch-machine.ts` file used robot3 (a finite state machine library) to manage UI navigation state for the Watch component — which panel is showing, scroll offsets, and async API call status (kill/pause/resume/message). This was over-engineered for what amounts to "which view am I looking at + is an API call in flight."

The motivation came from evaluating a simplification proposal. The user wanted to assess whether the state machine was worth the complexity cost.

## Log

### Evaluation

The key insight was distinguishing this from the _other_ robot3 usage in the codebase. The brain execution state machine (`brain-state-machine.ts` in core) is a shared interpreter — the same machine replays events to reconstruct brain state across multiple consumers (CLI, watch component, etc.). That's a legitimate FSM use case with real invariants.

The watch machine is nothing like that. It's a private UI concern with one consumer. No replay, no shared contract, no domain invariants. Just view routing and loading spinners.

Evidence it wasn't earning its keep:

- 20 machine states collapsed to 6 view modes via `machineStateToViewMode`
- Every `transition()` was cast to `as any` (robot3's TS support is poor)
- The keyboard handler (`watch-keyboard.ts`) already gated invalid inputs, making the machine's transition restrictions redundant
- The 80-line switch statement in `useInput` mostly just forwarded `{ type: event.type }` — mapping one event to an identical event

### Approach

Replaced with `useReducer` + an async dispatch wrapper. The reducer handles pure state transitions. For the 4 async operations (kill, pause, resume, send message), the `send` wrapper intercepts the action, dispatches a "started" action, calls the API, then dispatches success/error.

The state shape changed from "machine state name + context bag" to a flat object with explicit status enums (`killStatus: 'idle' | 'confirming' | 'killing' | 'killed' | 'error'`). This eliminated the `machineStateToViewMode` mapping and all 6 helper functions.

robot3/react-robot stay in the CLI package — `brain-run.tsx`, `watch-resolver.tsx`, and `useBrainMachine.ts` still use them.

## Learnings

- **State machines earn their keep when they're shared interpreters**, not when they're private UI state. The brain execution machine is worth it because multiple consumers replay the same events through it. The watch machine was a single-consumer view router dressed up in formalism.

- **The `as any` cast density is a smell.** When every call to a library's API requires a cast, you're paying complexity costs without getting type safety — the main selling point of a typed state machine.

- **Keyboard handlers already provide input gating.** In a terminal UI where all input goes through a single `useInput` handler that checks booleans before dispatching, the state machine's transition restrictions are redundant. The protection happens upstream.

- **`useReducer` + async wrapper preserves the same API surface.** The consumer still calls `send({ type: 'CONFIRM_KILL' })` and doesn't know whether the action is sync or async. The wrapper intercepts async triggers, dispatches internal actions, and calls the API. Clean separation without a library.

## Solution

564 lines of robot3 machine → 280 lines of useReducer. The flat state shape with explicit status enums (`killStatus`, `pauseResumeStatus`, `messageStatus`) replaced both the machine state names and the context bag. The `watch.tsx` changes were minimal — just updating imports and destructuring from `watchState` directly instead of `watchState.context`.
