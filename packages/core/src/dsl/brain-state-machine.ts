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

/**
 * Represents a running brain in a nested tree structure.
 * Each brain can have at most one inner brain running at a time.
 */
export interface RunningBrain {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  parentStepId: string | null;
  steps: StepInfo[];
  innerBrain: RunningBrain | null;
  depth: number;
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
  // Core tracking - tree structure (primary)
  rootBrain: RunningBrain | null;
  // Flat stack (computed from tree for backwards compatibility)
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
  isWaiting: boolean;
  isError: boolean;
  isCancelled: boolean;

  // Step counter for top-level steps
  topLevelStepCount: number;

  // Total tokens used across all agent steps
  totalTokens: number;
}

export type ExecutionState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting'
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
// Tree Helper Functions
// ============================================================================

/**
 * Get the deepest (currently executing) brain in the tree.
 */
function getDeepestBrain(root: RunningBrain | null): RunningBrain | null {
  if (!root) return null;
  let current = root;
  while (current.innerBrain) {
    current = current.innerBrain;
  }
  return current;
}

/**
 * Clone tree with a new innerBrain attached to the deepest node.
 */
function cloneTreeWithNewInner(
  root: RunningBrain,
  newInner: RunningBrain
): RunningBrain {
  if (!root.innerBrain) {
    return { ...root, innerBrain: newInner };
  }
  return {
    ...root,
    innerBrain: cloneTreeWithNewInner(root.innerBrain, newInner),
  };
}

/**
 * Clone tree replacing the deepest brain.
 */
function cloneTreeReplacingDeepest(
  root: RunningBrain,
  replacement: RunningBrain
): RunningBrain {
  if (!root.innerBrain) {
    return replacement;
  }
  return {
    ...root,
    innerBrain: cloneTreeReplacingDeepest(root.innerBrain, replacement),
  };
}

/**
 * Clone tree updating steps on the deepest brain.
 */
function cloneTreeUpdatingDeepestSteps(
  root: RunningBrain,
  newSteps: StepInfo[]
): RunningBrain {
  if (!root.innerBrain) {
    return { ...root, steps: newSteps };
  }
  return {
    ...root,
    innerBrain: cloneTreeUpdatingDeepestSteps(root.innerBrain, newSteps),
  };
}

/**
 * Clone tree removing the deepest brain and attaching its steps to parent step.
 * Returns null if root is the deepest (no parent).
 */
function cloneTreeRemovingDeepest(root: RunningBrain): RunningBrain | null {
  if (!root.innerBrain) {
    // Root is the deepest - can't remove, return null
    return null;
  }

  if (!root.innerBrain.innerBrain) {
    // root.innerBrain is the deepest - remove it and attach steps to parent step
    const completedBrain = root.innerBrain;
    const updatedSteps = root.steps.map((step) => {
      if (step.id === completedBrain.parentStepId) {
        return {
          ...step,
          innerSteps: completedBrain.steps,
          status: STATUS.COMPLETE as StepInfo['status'],
        };
      }
      return step;
    });
    return { ...root, steps: updatedSteps, innerBrain: null };
  }

  // Recurse down
  return {
    ...root,
    innerBrain: cloneTreeRemovingDeepest(root.innerBrain),
  };
}

/**
 * Convert tree to flat array (for backwards compatibility).
 */
function treeToStack(root: RunningBrain | null): BrainStackEntry[] {
  const stack: BrainStackEntry[] = [];
  let current = root;
  while (current) {
    stack.push({
      brainRunId: current.brainRunId,
      brainTitle: current.brainTitle,
      brainDescription: current.brainDescription,
      parentStepId: current.parentStepId,
      steps: current.steps,
    });
    current = current.innerBrain;
  }
  return stack;
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
  rootBrain: null,
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
  isWaiting: false,
  isError: false,
  isCancelled: false,
  topLevelStepCount: 0,
  totalTokens: 0,
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
      // Phase 3 will change this to STATUS.PAUSED when signal pausing is implemented
      status = STATUS.RUNNING;
      break;
    case 'waiting':
      status = STATUS.WAITING;
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
    isWaiting: executionState === 'waiting',
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
      rootBrain,
      depth,
      brainRunId: existingBrainRunId,
      currentState,
      options,
    } = ctx;

    const newDepth = depth + 1;
    const newBrain: RunningBrain = {
      brainRunId,
      brainTitle,
      brainDescription,
      parentStepId: currentStepId,
      steps: [],
      innerBrain: null,
      depth: newDepth,
    };

    // Build tree: if no root, this is root; else attach to deepest
    const newRootBrain = rootBrain
      ? cloneTreeWithNewInner(rootBrain, newBrain)
      : newBrain;

    const newCtx: BrainExecutionContext = {
      ...ctx,
      rootBrain: newRootBrain,
      brainStack: treeToStack(newRootBrain),
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
      rootBrain,
      depth,
      brainRunId: existingBrainRunId,
      options,
    } = ctx;

    // brain:restart can be either:
    // 1. A resume of an existing brain on the stack (same brainTitle) - should REPLACE
    // 2. A nested inner brain restarting (different brainTitle) - should ADD
    if (rootBrain) {
      const deepestBrain = getDeepestBrain(rootBrain);

      // If the deepest brain has the same title, this is a resume - replace it
      if (deepestBrain && deepestBrain.brainTitle === brainTitle) {
        const replacementBrain: RunningBrain = {
          brainRunId,
          brainTitle,
          brainDescription,
          parentStepId: deepestBrain.parentStepId, // Keep original parentStepId
          steps: [], // Steps will be populated by subsequent step:status events
          innerBrain: null,
          depth: deepestBrain.depth,
        };

        const newRootBrain = cloneTreeReplacingDeepest(rootBrain, replacementBrain);

        const newCtx: BrainExecutionContext = {
          ...ctx,
          rootBrain: newRootBrain,
          brainStack: treeToStack(newRootBrain),
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

      // Different title - this is a nested inner brain restarting, ADD to tree
      const newDepth = depth + 1;
      const newBrain: RunningBrain = {
        brainRunId,
        brainTitle,
        brainDescription,
        parentStepId: currentStepId,
        steps: [],
        innerBrain: null,
        depth: newDepth,
      };

      const newRootBrain = cloneTreeWithNewInner(rootBrain, newBrain);

      const newCtx: BrainExecutionContext = {
        ...ctx,
        rootBrain: newRootBrain,
        brainStack: treeToStack(newRootBrain),
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
    const newBrain: RunningBrain = {
      brainRunId,
      brainTitle,
      brainDescription,
      parentStepId: null,
      steps: [],
      innerBrain: null,
      depth: 1,
    };

    const newCtx: BrainExecutionContext = {
      ...ctx,
      rootBrain: newBrain,
      brainStack: treeToStack(newBrain),
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
  const { rootBrain, depth, brainRunId, options } = ctx;

  if (!rootBrain) return ctx;

  const completedBrain = getDeepestBrain(rootBrain);
  if (!completedBrain) return ctx;

  const newDepth = depth - 1;
  const isOuterBrainComplete = newDepth === 0;

  // When the outer brain completes, keep rootBrain so we can still display
  // the final state. Only remove inner brains (attaching their steps to parent).
  const newRootBrain = isOuterBrainComplete
    ? rootBrain
    : cloneTreeRemovingDeepest(rootBrain);

  const newCtx: BrainExecutionContext = {
    ...ctx,
    rootBrain: newRootBrain,
    brainStack: treeToStack(newRootBrain),
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

  return updateDerivedState(newCtx, isOuterBrainComplete ? 'complete' : 'running');
});

const errorBrain = reduce<BrainExecutionContext, ErrorPayload>(
  (ctx, { error }) => {
    const { rootBrain, brainRunId, options } = ctx;
    const currentBrain = getDeepestBrain(rootBrain);

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
  const { rootBrain, brainRunId, options } = ctx;
  const currentBrain = getDeepestBrain(rootBrain);

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
    const { rootBrain, brainRunId, options } = ctx;

    // Add step to current brain's steps if not already there
    let newRootBrain = rootBrain;
    if (rootBrain) {
      const currentBrain = getDeepestBrain(rootBrain);
      if (currentBrain) {
        const existingStep = currentBrain.steps.find((s) => s.id === stepId);
        let newSteps: StepInfo[];
        if (!existingStep) {
          newSteps = [
            ...currentBrain.steps,
            { id: stepId, title: stepTitle, status: STATUS.RUNNING },
          ];
        } else {
          newSteps = currentBrain.steps.map((s) =>
            s.id === stepId ? { ...s, status: STATUS.RUNNING } : s
          );
        }
        newRootBrain = cloneTreeUpdatingDeepestSteps(rootBrain, newSteps);
      }
    }

    return {
      ...ctx,
      rootBrain: newRootBrain,
      brainStack: treeToStack(newRootBrain),
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
      rootBrain,
      depth,
      currentState,
      topLevelStepCount,
      brainRunId,
      options,
    } = ctx;

    let newRootBrain = rootBrain;
    if (rootBrain) {
      const currentBrain = getDeepestBrain(rootBrain);
      if (currentBrain) {
        const newSteps = currentBrain.steps.map((s) =>
          s.id === stepId ? { ...s, status: STATUS.COMPLETE as StepInfo['status'], patch } : s
        );
        newRootBrain = cloneTreeUpdatingDeepestSteps(rootBrain, newSteps);
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
      rootBrain: newRootBrain,
      brainStack: treeToStack(newRootBrain),
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
    const { brainRunId, rootBrain, options } = ctx;

    if (!rootBrain) return ctx;

    // Only update the current (deepest) brain in the tree.
    // STEP_STATUS is emitted by the currently executing brain, which is always
    // the deepest one. We can't match by brainRunId because nested brains share
    // the same brainRunId, which would incorrectly update all nested brains.
    const currentBrain = getDeepestBrain(rootBrain);
    if (!currentBrain) return ctx;

    // Create a map of existing steps to preserve their patches
    const existingStepsById = new Map(currentBrain.steps.map((s) => [s.id, s]));

    const newSteps = steps.map((s) => {
      const existing = existingStepsById.get(s.id);
      return {
        id: s.id,
        title: s.title,
        status: s.status as StepInfo['status'],
        // Preserve existing patch if we have one
        ...(existing?.patch ? { patch: existing.patch } : {}),
      };
    });

    const newRootBrain = cloneTreeUpdatingDeepestSteps(rootBrain, newSteps);

    return {
      ...ctx,
      rootBrain: newRootBrain,
      brainStack: treeToStack(newRootBrain),
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

// Reducer for agent iteration events that tracks tokens per-iteration
// This ensures tokens are counted even if the agent doesn't complete (e.g., webhook interruption)
const agentIteration = reduce<BrainExecutionContext, any>((ctx, ev) => {
  const { brainRunId, options, totalTokens } = ctx;
  const { type: _actionType, ...eventData } = ev;

  return {
    ...ctx,
    totalTokens: totalTokens + (ev.tokensThisIteration ?? 0),
    currentEvent: {
      type: BRAIN_EVENTS.AGENT_ITERATION,
      brainRunId: brainRunId!,
      options,
      ...eventData,
    },
  };
});

// Reducer for agent terminal events - tokens already tracked via iterations
const agentTerminal = (eventType: string) =>
  reduce<BrainExecutionContext, any>((ctx, ev) => {
    const { brainRunId, options } = ctx;
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

// Internal machine factory - called with pre-built context
const makeBrainMachine = (initialContext: BrainExecutionContext) =>
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

        // Agent events (pass-through with event data)
        transition(
          BRAIN_EVENTS.AGENT_START,
          'running',
          passthrough(BRAIN_EVENTS.AGENT_START)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_ITERATION,
          'running',
          agentIteration
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_TOOL_CALL,
          'running',
          passthrough(BRAIN_EVENTS.AGENT_TOOL_CALL)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_TOOL_RESULT,
          'running',
          passthrough(BRAIN_EVENTS.AGENT_TOOL_RESULT)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
          'running',
          passthrough(BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_COMPLETE,
          'running',
          agentTerminal(BRAIN_EVENTS.AGENT_COMPLETE)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_TOKEN_LIMIT,
          'running',
          agentTerminal(BRAIN_EVENTS.AGENT_TOKEN_LIMIT)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_ITERATION_LIMIT,
          'running',
          agentTerminal(BRAIN_EVENTS.AGENT_ITERATION_LIMIT)
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_WEBHOOK,
          'running',
          passthrough(BRAIN_EVENTS.AGENT_WEBHOOK)
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
  const machine = makeBrainMachine(initialContext);
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
 * Create an uninterpreted brain execution machine.
 * Use with robot3's interpret() or react-robot's useMachine() hook.
 */
export function createBrainMachine(options?: CreateMachineOptions) {
  const initialContext = createInitialContext(options);
  return makeBrainMachine(initialContext);
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
  const { rootBrain, currentStepId } = machine.context;

  if (!rootBrain || !currentStepId) return null;

  const currentBrain = getDeepestBrain(rootBrain);
  return currentBrain?.steps.find((s) => s.id === currentStepId) ?? null;
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
 * This reconstructs the nested step hierarchy from the brain tree.
 * Returns a deep copy to avoid mutating the state machine's context.
 */
export function getCompletedSteps(machine: BrainStateMachine): StepInfo[] {
  const { rootBrain } = machine.context;

  if (!rootBrain) {
    return [];
  }

  // Deep copy the steps, including any innerBrain's steps attached to parent step
  const copyStep = (step: StepInfo): StepInfo => ({
    ...step,
    innerSteps: step.innerSteps?.map(copyStep),
  });

  // Recursively build steps from the brain tree
  const copyBrainSteps = (brain: RunningBrain): StepInfo[] => {
    const steps = brain.steps.map(copyStep);

    // If there's a running inner brain, attach its steps to the parent step
    if (brain.innerBrain) {
      const parentStepId = brain.innerBrain.parentStepId;
      if (parentStepId) {
        const parentStep = steps.find((s) => s.id === parentStepId);
        if (parentStep) {
          parentStep.innerSteps = copyBrainSteps(brain.innerBrain);
        }
      }
    }

    return steps;
  };

  return copyBrainSteps(rootBrain);
}
