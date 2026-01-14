import * as robot3 from 'robot3';
// Use namespace import to work around ESM/CJS interop issues with robot3.
// When installed globally or on different Node.js versions, the package may
// resolve to its CJS entry point which doesn't properly expose named exports.
const { createMachine, state, transition, reduce, guard, interpret } = robot3;
import { BRAIN_EVENTS, STATUS } from './constants.js';
import { applyPatches } from './json-patch.js';
import type { JsonPatch, JsonObject } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface BrainStackEntry {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  parentStepId: string | null;
  steps: StepInfo[];
}

export interface StepInfo {
  id: string;
  title: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  patch?: JsonPatch;
  innerSteps?: StepInfo[];
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface WebhookRegistration {
  name: string;
  identifier: string;
}

// The event structure that gets yielded
export interface BrainEvent {
  type: string;
  brainRunId: string;
  options: JsonObject;
  [key: string]: unknown;
}

export interface BrainExecutionContext {
  // Core tracking
  brainStack: BrainStackEntry[];
  depth: number;
  brainRunId: string | null;
  currentStepId: string | null;
  currentStepTitle: string | null;
  error: SerializedError | null;
  pendingWebhooks: WebhookRegistration[] | null;

  // The current brain state (with patches applied for top-level)
  currentState: JsonObject;

  // The event that was just produced (yield this after sendAction)
  currentEvent: BrainEvent | null;

  // Options to include in every event
  options: JsonObject;

  // Derived state (updated by reducers)
  // The authoritative status (depth-aware) - use this instead of checking event.status
  status: (typeof STATUS)[keyof typeof STATUS];
  isTopLevel: boolean;
  isRunning: boolean;
  isComplete: boolean;
  isPaused: boolean;
  isError: boolean;
  isCancelled: boolean;

  // Step counter for top-level steps
  topLevelStepCount: number;
}

export type ExecutionState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

// Payload types for transitions
export interface StartBrainPayload {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  initialState?: JsonObject;
}

export interface StartStepPayload {
  stepId: string;
  stepTitle: string;
}

export interface CompleteStepPayload {
  stepId: string;
  stepTitle: string;
  patch?: JsonPatch;
}

export interface WebhookPayload {
  waitFor: WebhookRegistration[];
}

export interface ErrorPayload {
  error: SerializedError;
}

export interface StepStatusPayload {
  brainRunId: string;
  steps: Array<{ id: string; title: string; status: string }>;
}

export interface StepRetryPayload {
  stepId: string;
  stepTitle: string;
  error: SerializedError;
  attempt: number;
}

// ============================================================================
// Context Factory
// ============================================================================

export interface CreateMachineOptions {
  initialState?: JsonObject;
  options?: JsonObject;
  /** Events to replay through the machine to restore state */
  events?: Array<{ type: string } & Record<string, unknown>>;
}

const createInitialContext = (
  opts?: CreateMachineOptions
): BrainExecutionContext => ({
  brainStack: [],
  depth: 0,
  brainRunId: null,
  currentStepId: null,
  currentStepTitle: null,
  error: null,
  pendingWebhooks: null,
  currentState: opts?.initialState ?? {},
  currentEvent: null,
  options: opts?.options ?? {},
  status: STATUS.PENDING,
  isTopLevel: false,
  isRunning: false,
  isComplete: false,
  isPaused: false,
  isError: false,
  isCancelled: false,
  topLevelStepCount: 0,
});

// ============================================================================
// Helper to update derived state
// ============================================================================

const updateDerivedState = (
  ctx: BrainExecutionContext,
  executionState: ExecutionState
): BrainExecutionContext => {
  // Map ExecutionState to STATUS - this gives consumers the authoritative status
  let status: (typeof STATUS)[keyof typeof STATUS];
  switch (executionState) {
    case 'idle':
      status = STATUS.PENDING;
      break;
    case 'running':
      status = STATUS.RUNNING;
      break;
    case 'paused':
      // Paused brains are still considered "running" in terms of database status
      status = STATUS.RUNNING;
      break;
    case 'complete':
      status = STATUS.COMPLETE;
      break;
    case 'error':
      status = STATUS.ERROR;
      break;
    case 'cancelled':
      status = STATUS.CANCELLED;
      break;
    default:
      status = STATUS.RUNNING;
  }

  return {
    ...ctx,
    status,
    isTopLevel: ctx.depth === 1,
    isRunning: executionState === 'running',
    isComplete: executionState === 'complete',
    isPaused: executionState === 'paused',
    isError: executionState === 'error',
    isCancelled: executionState === 'cancelled',
  };
};

// ============================================================================
// Reducers - Update context on transitions
// ============================================================================

const startBrain = reduce<BrainExecutionContext, StartBrainPayload>(
  (ctx, { brainRunId, brainTitle, brainDescription, initialState }) => {
    const {
      currentStepId,
      brainStack,
      depth,
      brainRunId: existingBrainRunId,
      currentState,
      options,
    } = ctx;

    const newEntry: BrainStackEntry = {
      brainRunId,
      brainTitle,
      brainDescription,
      parentStepId: currentStepId,
      steps: [],
    };

    const newDepth = depth + 1;
    const newCtx: BrainExecutionContext = {
      ...ctx,
      brainStack: [...brainStack, newEntry],
      depth: newDepth,
      brainRunId: existingBrainRunId ?? brainRunId,
      currentState:
        newDepth === 1 ? initialState ?? currentState : currentState,
      currentEvent: {
        type: BRAIN_EVENTS.START,
        brainTitle,
        brainDescription,
        brainRunId,
        initialState: initialState ?? {},
        status: STATUS.RUNNING,
        options,
      },
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const restartBrain = reduce<BrainExecutionContext, StartBrainPayload>(
  (ctx, { brainRunId, brainTitle, brainDescription, initialState }) => {
    const {
      currentStepId,
      brainStack,
      depth,
      brainRunId: existingBrainRunId,
      options,
    } = ctx;

    // brain:restart can be either:
    // 1. A resume of an existing brain on the stack (same brainTitle) - should REPLACE
    // 2. A nested inner brain restarting (different brainTitle) - should ADD
    if (brainStack.length > 0) {
      const lastBrain = brainStack[brainStack.length - 1];

      // If the last brain has the same title, this is a resume - replace it
      if (lastBrain.brainTitle === brainTitle) {
        const newEntry: BrainStackEntry = {
          brainRunId,
          brainTitle,
          brainDescription,
          parentStepId: lastBrain.parentStepId, // Keep original parentStepId
          steps: [], // Steps will be populated by subsequent step:status events
        };

        const newStack = [...brainStack.slice(0, -1), newEntry];

        const newCtx: BrainExecutionContext = {
          ...ctx,
          brainStack: newStack,
          // depth stays the same - we're replacing, not nesting
          brainRunId: existingBrainRunId ?? brainRunId,
          currentEvent: {
            type: BRAIN_EVENTS.RESTART,
            brainTitle,
            brainDescription,
            brainRunId,
            initialState: initialState ?? {},
            status: STATUS.RUNNING,
            options,
          },
        };

        return updateDerivedState(newCtx, 'running');
      }

      // Different title - this is a nested inner brain restarting, ADD to stack
      const newEntry: BrainStackEntry = {
        brainRunId,
        brainTitle,
        brainDescription,
        parentStepId: currentStepId,
        steps: [],
      };

      const newDepth = depth + 1;
      const newCtx: BrainExecutionContext = {
        ...ctx,
        brainStack: [...brainStack, newEntry],
        depth: newDepth,
        brainRunId: existingBrainRunId ?? brainRunId,
        currentEvent: {
          type: BRAIN_EVENTS.RESTART,
          brainTitle,
          brainDescription,
          brainRunId,
          initialState: initialState ?? {},
          status: STATUS.RUNNING,
          options,
        },
      };

      return updateDerivedState(newCtx, 'running');
    }

    // No brain on stack - this is a fresh restart from idle state
    const newEntry: BrainStackEntry = {
      brainRunId,
      brainTitle,
      brainDescription,
      parentStepId: null,
      steps: [],
    };

    const newCtx: BrainExecutionContext = {
      ...ctx,
      brainStack: [newEntry],
      depth: 1,
      brainRunId: existingBrainRunId ?? brainRunId,
      currentEvent: {
        type: BRAIN_EVENTS.RESTART,
        brainTitle,
        brainDescription,
        brainRunId,
        initialState: initialState ?? {},
        status: STATUS.RUNNING,
        options,
      },
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const completeBrain = reduce<BrainExecutionContext, object>((ctx) => {
  const { brainStack, depth, brainRunId, options } = ctx;

  if (brainStack.length === 0) return ctx;

  const completedBrain = brainStack[brainStack.length - 1];
  const newStack = brainStack.slice(0, -1);

  // Attach completed brain's steps to parent step if nested
  if (newStack.length > 0 && completedBrain.parentStepId) {
    const parentBrain = newStack[newStack.length - 1];
    const parentStep = parentBrain.steps.find(
      (s) => s.id === completedBrain.parentStepId
    );
    if (parentStep) {
      parentStep.innerSteps = completedBrain.steps;
      parentStep.status = STATUS.COMPLETE;
    }
  }

  const newDepth = depth - 1;
  const isNowComplete = newDepth === 0;

  const newCtx: BrainExecutionContext = {
    ...ctx,
    brainStack: newStack,
    depth: newDepth,
    currentEvent: {
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: completedBrain.brainTitle,
      brainDescription: completedBrain.brainDescription,
      brainRunId: brainRunId!,
      status: STATUS.COMPLETE,
      options,
    },
  };

  return updateDerivedState(newCtx, isNowComplete ? 'complete' : 'running');
});

const errorBrain = reduce<BrainExecutionContext, ErrorPayload>(
  (ctx, { error }) => {
    const { brainStack, brainRunId, options } = ctx;
    const currentBrain = brainStack[brainStack.length - 1];

    const newCtx: BrainExecutionContext = {
      ...ctx,
      error,
      currentEvent: {
        type: BRAIN_EVENTS.ERROR,
        brainTitle: currentBrain?.brainTitle,
        brainDescription: currentBrain?.brainDescription,
        brainRunId: brainRunId!,
        error,
        status: STATUS.ERROR,
        options,
      },
    };

    return updateDerivedState(newCtx, 'error');
  }
);

const cancelBrain = reduce<BrainExecutionContext, object>((ctx) => {
  const { brainStack, brainRunId, options } = ctx;
  const currentBrain = brainStack[brainStack.length - 1];

  const newCtx: BrainExecutionContext = {
    ...ctx,
    currentEvent: {
      type: BRAIN_EVENTS.CANCELLED,
      brainTitle: currentBrain?.brainTitle,
      brainDescription: currentBrain?.brainDescription,
      brainRunId: brainRunId!,
      status: STATUS.CANCELLED,
      options,
    },
  };

  return updateDerivedState(newCtx, 'cancelled');
});

const startStep = reduce<BrainExecutionContext, StartStepPayload>(
  (ctx, { stepId, stepTitle }) => {
    const { brainStack, brainRunId, options } = ctx;

    // Add step to current brain's steps if not already there
    if (brainStack.length > 0) {
      const currentBrain = brainStack[brainStack.length - 1];
      const existingStep = currentBrain.steps.find((s) => s.id === stepId);
      if (!existingStep) {
        currentBrain.steps.push({
          id: stepId,
          title: stepTitle,
          status: STATUS.RUNNING,
        });
      } else {
        existingStep.status = STATUS.RUNNING;
      }
    }

    return {
      ...ctx,
      currentStepId: stepId,
      currentStepTitle: stepTitle,
      currentEvent: {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId: brainRunId!,
        stepId,
        stepTitle,
        status: STATUS.RUNNING,
        options,
      },
    };
  }
);

const completeStep = reduce<BrainExecutionContext, CompleteStepPayload>(
  (ctx, { stepId, stepTitle, patch }) => {
    const {
      brainStack,
      depth,
      currentState,
      topLevelStepCount,
      brainRunId,
      options,
    } = ctx;

    if (brainStack.length > 0) {
      const currentBrain = brainStack[brainStack.length - 1];
      const step = currentBrain.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = STATUS.COMPLETE;
        step.patch = patch;
      }
    }

    // Apply patch to currentState only for top-level brain
    let newState = currentState;
    let newStepCount = topLevelStepCount;
    if (depth === 1 && patch) {
      newState = applyPatches(currentState, [patch]) as JsonObject;
      newStepCount = topLevelStepCount + 1;
    }

    return {
      ...ctx,
      currentState: newState,
      topLevelStepCount: newStepCount,
      currentEvent: {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: brainRunId!,
        stepId,
        stepTitle,
        patch,
        status: STATUS.RUNNING,
        options,
      },
    };
  }
);

const webhookPause = reduce<BrainExecutionContext, WebhookPayload>(
  (ctx, { waitFor }) => {
    const { brainRunId, options } = ctx;

    const newCtx: BrainExecutionContext = {
      ...ctx,
      pendingWebhooks: waitFor,
      currentEvent: {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId: brainRunId!,
        waitFor,
        options,
      },
    };

    return updateDerivedState(newCtx, 'paused');
  }
);

const webhookResponse = reduce<BrainExecutionContext, { response: JsonObject }>(
  (ctx, { response }) => {
    const { brainRunId, options } = ctx;

    const newCtx: BrainExecutionContext = {
      ...ctx,
      pendingWebhooks: null,
      currentEvent: {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        brainRunId: brainRunId!,
        response,
        options,
      },
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const stepStatus = reduce<BrainExecutionContext, StepStatusPayload>(
  (ctx, { brainRunId: eventBrainRunId, steps }) => {
    const { brainRunId, brainStack, options } = ctx;

    if (brainStack.length === 0) return ctx;

    // Only update the current (deepest) brain on the stack.
    // STEP_STATUS is emitted by the currently executing brain, which is always
    // the deepest one. We can't match by brainRunId because nested brains share
    // the same brainRunId, which would incorrectly update all nested brains.
    const updatedStack = brainStack.map((brain, index) => {
      if (index === brainStack.length - 1) {
        // Create a map of existing steps to preserve their patches
        const existingStepsById = new Map(brain.steps.map((s) => [s.id, s]));

        return {
          ...brain,
          steps: steps.map((s) => {
            const existing = existingStepsById.get(s.id);
            return {
              id: s.id,
              title: s.title,
              status: s.status as StepInfo['status'],
              // Preserve existing patch if we have one
              ...(existing?.patch ? { patch: existing.patch } : {}),
            };
          }),
        };
      }
      return brain;
    });

    return {
      ...ctx,
      brainStack: updatedStack,
      currentEvent: {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId: brainRunId!,
        steps,
        options,
      },
    };
  }
);

const stepRetry = reduce<BrainExecutionContext, StepRetryPayload>(
  (ctx, { stepId, stepTitle, error, attempt }) => {
    const { brainRunId, options } = ctx;

    return {
      ...ctx,
      currentEvent: {
        type: BRAIN_EVENTS.STEP_RETRY,
        brainRunId: brainRunId!,
        stepId,
        stepTitle,
        error,
        attempt,
        options,
      },
    };
  }
);

const passthrough = (eventType: string) =>
  reduce<BrainExecutionContext, any>((ctx, ev) => {
    const { brainRunId, options } = ctx;
    // Destructure to exclude 'type' (the action name) from being spread into currentEvent
    const { type: _actionType, ...eventData } = ev;

    return {
      ...ctx,
      currentEvent: {
        type: eventType,
        brainRunId: brainRunId!,
        options,
        ...eventData,
      },
    };
  });

// ============================================================================
// Guards - Conditional transitions
// ============================================================================

const isOuterBrain = guard<BrainExecutionContext, object>(
  (ctx) => ctx.depth === 1
);
const isInnerBrain = guard<BrainExecutionContext, object>(
  (ctx) => ctx.depth > 1
);

// ============================================================================
// State Machine Definition
// ============================================================================

// Create machine factory - needs to be called with initial context
const createBrainMachine = (initialContext: BrainExecutionContext) =>
  createMachine(
    'idle',
    {
      idle: state(
        transition(BRAIN_EVENTS.START, 'running', startBrain),
        transition(BRAIN_EVENTS.RESTART, 'running', restartBrain) as any
      ),

      running: state(
        // Nested brain lifecycle
        transition(BRAIN_EVENTS.START, 'running', startBrain),
        transition(BRAIN_EVENTS.RESTART, 'running', restartBrain) as any,

        // Outer brain complete -> terminal
        transition(
          BRAIN_EVENTS.COMPLETE,
          'complete',
          isOuterBrain,
          completeBrain
        ) as any,
        // Inner brain complete -> stay running
        transition(
          BRAIN_EVENTS.COMPLETE,
          'running',
          isInnerBrain,
          completeBrain
        ) as any,

        // Error (only outer brain errors are terminal)
        transition(
          BRAIN_EVENTS.ERROR,
          'error',
          isOuterBrain,
          errorBrain
        ) as any,

        // Cancelled
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,

        // Webhook -> paused
        transition(BRAIN_EVENTS.WEBHOOK, 'paused', webhookPause) as any,

        // Webhook response (for resume from webhook - machine is already running)
        transition(
          BRAIN_EVENTS.WEBHOOK_RESPONSE,
          'running',
          webhookResponse
        ) as any,

        // Step events
        transition(BRAIN_EVENTS.STEP_START, 'running', startStep) as any,
        transition(BRAIN_EVENTS.STEP_COMPLETE, 'running', completeStep) as any,
        transition(BRAIN_EVENTS.STEP_STATUS, 'running', stepStatus) as any,
        transition(BRAIN_EVENTS.STEP_RETRY, 'running', stepRetry) as any,

        // Loop events (pass-through with event data)
        transition(
          BRAIN_EVENTS.LOOP_START,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_START)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_ITERATION,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_ITERATION)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_TOOL_CALL,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_TOOL_CALL)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_TOOL_RESULT,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_TOOL_RESULT)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_COMPLETE,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_COMPLETE)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_TOKEN_LIMIT,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_TOKEN_LIMIT)
        ) as any,
        transition(
          BRAIN_EVENTS.LOOP_WEBHOOK,
          'running',
          passthrough(BRAIN_EVENTS.LOOP_WEBHOOK)
        ) as any,
        transition(
          BRAIN_EVENTS.HEARTBEAT,
          'running',
          passthrough(BRAIN_EVENTS.HEARTBEAT)
        ) as any
      ),

      paused: state(
        transition(BRAIN_EVENTS.WEBHOOK_RESPONSE, 'running', webhookResponse),
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,
        // RESTART happens when resuming from webhook
        transition(BRAIN_EVENTS.RESTART, 'running', restartBrain) as any
      ),

      // Terminal states - limited outgoing transitions
      complete: state(),
      error: state(
        // Allow STEP_STATUS after error so we can emit the final step statuses
        transition(BRAIN_EVENTS.STEP_STATUS, 'error', stepStatus) as any
      ),
      cancelled: state(),
    },
    () => initialContext
  );

// ============================================================================
// Public API
// ============================================================================

// Service type for our brain state machine
export interface BrainStateMachine {
  machine: { current: string; context: BrainExecutionContext };
  context: BrainExecutionContext;
  send: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * Create a new brain execution state machine.
 * Optionally replay events to restore state from history.
 */
export function createBrainExecutionMachine(
  options?: CreateMachineOptions
): BrainStateMachine {
  const initialContext = createInitialContext(options);
  const machine = createBrainMachine(initialContext);
  const service = interpret(machine, () => {});

  // Replay events if provided - just send each event directly to the machine
  if (options?.events) {
    for (const event of options.events) {
      service.send(event);
    }
  }

  return service;
}

/**
 * Send an event to the machine.
 * The machine transitions use BRAIN_EVENTS types directly, so just pass the event through.
 */
export function sendEvent(
  machine: BrainStateMachine,
  event: { type: string } & Record<string, any>
): void {
  machine.send(event);
}

// ============================================================================
// Query Helpers (kept for backwards compatibility, but context is now preferred)
// ============================================================================

export function getDepth(machine: BrainStateMachine): number {
  return machine.context.depth;
}

export function isTopLevel(machine: BrainStateMachine): boolean {
  return machine.context.isTopLevel;
}

export function getCurrentStep(machine: BrainStateMachine): StepInfo | null {
  const { brainStack, currentStepId } = machine.context;

  if (brainStack.length === 0 || !currentStepId) return null;

  const currentBrain = brainStack[brainStack.length - 1];
  return currentBrain.steps.find((s) => s.id === currentStepId) ?? null;
}

export function getBrainStack(machine: BrainStateMachine): BrainStackEntry[] {
  return machine.context.brainStack;
}

export function getBrainRunId(machine: BrainStateMachine): string | null {
  return machine.context.brainRunId;
}

export function getExecutionState(machine: BrainStateMachine): ExecutionState {
  return machine.machine.current as ExecutionState;
}

export function getPendingWebhooks(
  machine: BrainStateMachine
): WebhookRegistration[] | null {
  return machine.context.pendingWebhooks;
}

export function getError(machine: BrainStateMachine): SerializedError | null {
  return machine.context.error;
}

/**
 * Get the completed steps from the state machine in the format needed for resume.
 * This reconstructs the nested step hierarchy from the brain stack.
 * Returns a deep copy to avoid mutating the state machine's context.
 */
export function getCompletedSteps(machine: BrainStateMachine): StepInfo[] {
  const { brainStack } = machine.context;

  if (brainStack.length === 0) {
    return [];
  }

  // Deep copy the steps to avoid mutating state machine context
  const copyStep = (step: StepInfo): StepInfo => ({
    ...step,
    innerSteps: step.innerSteps?.map(copyStep),
  });

  const copyBrainStack = brainStack.map((brain) => ({
    ...brain,
    steps: brain.steps.map(copyStep),
  }));

  // The outer brain's steps, with inner brain steps nested
  const outerBrain = copyBrainStack[0];

  // If there are nested brains still on the stack (paused mid-execution),
  // attach their steps to the parent step as innerSteps
  if (copyBrainStack.length > 1) {
    for (let i = copyBrainStack.length - 1; i > 0; i--) {
      const innerBrain = copyBrainStack[i];
      const parentBrain = copyBrainStack[i - 1];
      // Find the parent step (the one that started this inner brain)
      const parentStep = parentBrain.steps.find(
        (s) => s.id === innerBrain.parentStepId
      );
      if (parentStep) {
        parentStep.innerSteps = innerBrain.steps;
      }
    }
  }

  return outerBrain.steps;
}
