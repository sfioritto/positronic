import * as robot3 from 'robot3';
// Use namespace import to work around ESM/CJS interop issues with robot3.
// When installed globally or on different Node.js versions, the package may
// resolve to its CJS entry point which doesn't properly expose named exports.
const { createMachine, state, transition, reduce, guard, interpret } = robot3;
import { BRAIN_EVENTS, STATUS } from './constants.js';
import { applyPatches } from './json-patch.js';
import type { JsonPatch, JsonObject } from './types.js';
import type { ResponseMessage } from '../clients/types.js';

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

/**
 * Context for tracking agent execution state.
 * This allows the state machine to preserve agent context across pauses/resumes.
 */
export interface AgentContext {
  /** The step that started this agent */
  stepId: string;
  stepTitle: string;
  /** Initial prompt from AGENT_START */
  prompt: string;
  /** System prompt from AGENT_START (optional) */
  system?: string;
  /** SDK-native messages accumulated from AGENT_RAW_RESPONSE_MESSAGE events */
  responseMessages: ResponseMessage[];
  /** Tool call ID when agent is waiting for webhook response */
  pendingToolCallId: string | null;
  /** Tool name when agent is waiting for webhook response */
  pendingToolName: string | null;
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

  // Options passed to the brain run (stored for context, not used for event creation)
  options: JsonObject;

  // Agent context - tracks agent execution state for pause/resume
  // Non-null when we're inside an agent loop (or paused from one)
  agentContext: AgentContext | null;

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
  // True when execution is inside an agent loop
  isInAgentLoop: boolean;

  // Step counter for top-level steps
  topLevelStepCount: number;

  // Total tokens used across all agent steps
  totalTokens: number;
}

export type ExecutionState =
  | 'idle'
  | 'running'
  | 'agentLoop'
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
  options: opts?.options ?? {},
  agentContext: null,
  status: STATUS.PENDING,
  isTopLevel: false,
  isRunning: false,
  isComplete: false,
  isPaused: false,
  isWaiting: false,
  isError: false,
  isCancelled: false,
  isInAgentLoop: false,
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
  // Note: agentLoop maps to RUNNING publicly (consumers don't need to know the difference)
  let status: (typeof STATUS)[keyof typeof STATUS];
  switch (executionState) {
    case 'idle':
      status = STATUS.PENDING;
      break;
    case 'running':
      status = STATUS.RUNNING;
      break;
    case 'agentLoop':
      status = STATUS.RUNNING; // Publicly still "running"
      break;
    case 'paused':
      status = STATUS.PAUSED;
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
    isRunning: executionState === 'running' || executionState === 'agentLoop',
    isComplete: executionState === 'complete',
    isPaused: executionState === 'paused',
    isWaiting: executionState === 'waiting',
    isError: executionState === 'error',
    isCancelled: executionState === 'cancelled',
    isInAgentLoop: executionState === 'agentLoop',
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
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const restartBrain = reduce<BrainExecutionContext, StartBrainPayload>(
  (ctx, { brainRunId, brainTitle, brainDescription }) => {
    const {
      currentStepId,
      rootBrain,
      depth,
      brainRunId: existingBrainRunId,
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
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const completeBrain = reduce<BrainExecutionContext, object>((ctx) => {
  const { rootBrain, depth } = ctx;

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
  };

  return updateDerivedState(newCtx, isOuterBrainComplete ? 'complete' : 'running');
});

const errorBrain = reduce<BrainExecutionContext, ErrorPayload>(
  (ctx, { error }) => {
    const newCtx: BrainExecutionContext = {
      ...ctx,
      error,
    };

    return updateDerivedState(newCtx, 'error');
  }
);

const cancelBrain = reduce<BrainExecutionContext, object>((ctx) => {
  return updateDerivedState(ctx, 'cancelled');
});

const startStep = reduce<BrainExecutionContext, StartStepPayload>(
  (ctx, { stepId, stepTitle }) => {
    const { rootBrain } = ctx;

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
    };
  }
);

const completeStep = reduce<BrainExecutionContext, CompleteStepPayload>(
  (ctx, { stepId, patch }) => {
    const {
      rootBrain,
      depth,
      currentState,
      topLevelStepCount,
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
    };
  }
);

const webhookPause = reduce<BrainExecutionContext, WebhookPayload>(
  (ctx, { waitFor }) => {
    const newCtx: BrainExecutionContext = {
      ...ctx,
      pendingWebhooks: waitFor,
    };

    return updateDerivedState(newCtx, 'waiting');
  }
);

const pauseBrain = reduce<BrainExecutionContext, object>((ctx) => {
  return updateDerivedState(ctx, 'paused');
});

const webhookResponse = reduce<BrainExecutionContext, { response: JsonObject }>(
  (ctx) => {
    const newCtx: BrainExecutionContext = {
      ...ctx,
      pendingWebhooks: null,
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const stepStatus = reduce<BrainExecutionContext, StepStatusPayload>(
  (ctx, { steps }) => {
    const { rootBrain } = ctx;

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
    };
  }
);

// stepRetry is a no-op - we just let the event pass through
const stepRetry = reduce<BrainExecutionContext, StepRetryPayload>((ctx) => ctx);

// passthrough is now a no-op - we just let the event pass through
const passthrough = () => reduce<BrainExecutionContext, any>((ctx) => ctx);

// Reducer for agent iteration events that tracks tokens per-iteration
// This ensures tokens are counted even if the agent doesn't complete (e.g., webhook interruption)
const agentIteration = reduce<BrainExecutionContext, any>((ctx, ev) => {
  const { totalTokens } = ctx;

  return {
    ...ctx,
    totalTokens: totalTokens + (ev.tokensThisIteration ?? 0),
  };
});

// Reducer for agent terminal events - clears agentContext since the agent has completed
const agentTerminal = () =>
  reduce<BrainExecutionContext, any>((ctx) => {
    return {
      ...ctx,
      agentContext: null, // Clear agent context on completion
    };
  });

// ============================================================================
// Agent Loop Reducers - Manage agentContext for the explicit agent state
// ============================================================================

// Payload types for agent events
interface AgentStartPayload {
  stepId: string;
  stepTitle: string;
  prompt: string;
  system?: string;
  tools?: string[];
}

interface AgentRawResponseMessagePayload {
  stepId: string;
  stepTitle: string;
  iteration: number;
  message: ResponseMessage;
}

interface AgentWebhookPayload {
  stepId: string;
  stepTitle: string;
  toolCallId: string;
  toolName: string;
  input: JsonObject;
}

// Reducer for AGENT_START - initializes agentContext
const agentStart = reduce<BrainExecutionContext, AgentStartPayload>(
  (ctx, { stepId, stepTitle, prompt, system }) => {
    const newCtx: BrainExecutionContext = {
      ...ctx,
      agentContext: {
        stepId,
        stepTitle,
        prompt,
        system,
        responseMessages: [],
        pendingToolCallId: null,
        pendingToolName: null,
      },
    };

    return updateDerivedState(newCtx, 'agentLoop');
  }
);

// Reducer for AGENT_RAW_RESPONSE_MESSAGE - accumulates messages in agentContext
const agentRawResponseMessage = reduce<
  BrainExecutionContext,
  AgentRawResponseMessagePayload
>((ctx, { message }) => {
  const { agentContext } = ctx;

  // Accumulate the message in agentContext
  const updatedAgentContext = agentContext
    ? {
        ...agentContext,
        responseMessages: [...agentContext.responseMessages, message],
      }
    : null;

  return {
    ...ctx,
    agentContext: updatedAgentContext,
  };
});

// Reducer for AGENT_WEBHOOK - records pending tool call in agentContext
const agentWebhook = reduce<BrainExecutionContext, AgentWebhookPayload>(
  (ctx, { toolCallId, toolName }) => {
    const { agentContext } = ctx;

    // Update agentContext with pending tool info
    const updatedAgentContext = agentContext
      ? {
          ...agentContext,
          pendingToolCallId: toolCallId,
          pendingToolName: toolName,
        }
      : null;

    return {
      ...ctx,
      agentContext: updatedAgentContext,
    };
  }
);

// Reducer for AGENT_USER_MESSAGE - no-op, just stays in agentLoop
const agentUserMessage = reduce<BrainExecutionContext, any>((ctx) => ctx);

// ============================================================================
// Guards - Conditional transitions
// ============================================================================

const isOuterBrain = guard<BrainExecutionContext, object>(
  (ctx) => ctx.depth === 1
);
const isInnerBrain = guard<BrainExecutionContext, object>(
  (ctx) => ctx.depth > 1
);
// Guard to check if we have agentContext (for resuming to agentLoop)
const hasAgentContext = guard<BrainExecutionContext, object>(
  (ctx) => ctx.agentContext !== null
);

// ============================================================================
// State Machine Definition
// ============================================================================

// Define agent loop transitions as a reusable array for cleaner code
const agentLoopTransitions = [
  // Agent micro-events that stay in agentLoop
  transition(BRAIN_EVENTS.AGENT_ITERATION, 'agentLoop', agentIteration) as any,
  transition(
    BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
    'agentLoop',
    agentRawResponseMessage
  ) as any,
  transition(
    BRAIN_EVENTS.AGENT_TOOL_CALL,
    'agentLoop',
    passthrough()
  ) as any,
  transition(
    BRAIN_EVENTS.AGENT_TOOL_RESULT,
    'agentLoop',
    passthrough()
  ) as any,
  transition(
    BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
    'agentLoop',
    passthrough()
  ) as any,
  transition(BRAIN_EVENTS.AGENT_USER_MESSAGE, 'agentLoop', agentUserMessage) as any,
  // AGENT_WEBHOOK records pending tool call but stays in agentLoop
  transition(BRAIN_EVENTS.AGENT_WEBHOOK, 'agentLoop', agentWebhook) as any,
];

// Internal machine factory - called with pre-built context
const makeBrainMachine = (initialContext: BrainExecutionContext) =>
  createMachine(
    'idle',
    {
      idle: state(
        transition(BRAIN_EVENTS.START, 'running', startBrain),
        transition(BRAIN_EVENTS.RESTART, 'running', restartBrain) as any
      ),

      // Standard step execution state
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

        // Paused (by signal)
        transition(BRAIN_EVENTS.PAUSED, 'paused', pauseBrain) as any,

        // Webhook -> waiting (for non-agent webhooks)
        transition(BRAIN_EVENTS.WEBHOOK, 'waiting', webhookPause) as any,

        // Webhook response (for resume from non-agent webhook)
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

        // AGENT_START transitions to the agentLoop state
        transition(BRAIN_EVENTS.AGENT_START, 'agentLoop', agentStart) as any
      ),

      // Explicit agent loop state - isolates agent execution logic
      agentLoop: state(
        // Spread agent micro-transitions
        ...agentLoopTransitions,

        // Exit strategies - agent terminal events return to running
        transition(
          BRAIN_EVENTS.AGENT_COMPLETE,
          'running',
          agentTerminal()
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_TOKEN_LIMIT,
          'running',
          agentTerminal()
        ) as any,
        transition(
          BRAIN_EVENTS.AGENT_ITERATION_LIMIT,
          'running',
          agentTerminal()
        ) as any,

        // Interruption handling - can pause or wait from agentLoop
        transition(BRAIN_EVENTS.PAUSED, 'paused', pauseBrain) as any,
        transition(BRAIN_EVENTS.WEBHOOK, 'waiting', webhookPause) as any,

        // Error handling
        transition(
          BRAIN_EVENTS.ERROR,
          'error',
          isOuterBrain,
          errorBrain
        ) as any,
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any
      ),

      paused: state(
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,
        // RESTART happens when resuming from pause
        // If we have agentContext, resume to agentLoop; otherwise to running
        transition(
          BRAIN_EVENTS.RESTART,
          'agentLoop',
          hasAgentContext,
          restartBrain
        ) as any,
        transition(BRAIN_EVENTS.RESTART, 'running', restartBrain) as any
      ),

      waiting: state(
        // Webhook response - if we have agentContext, go back to agentLoop
        transition(
          BRAIN_EVENTS.WEBHOOK_RESPONSE,
          'agentLoop',
          hasAgentContext,
          webhookResponse
        ) as any,
        // Otherwise go to running
        transition(BRAIN_EVENTS.WEBHOOK_RESPONSE, 'running', webhookResponse),
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,
        // RESTART happens when resuming from webhook
        // If we have agentContext, resume to agentLoop; otherwise to running
        transition(
          BRAIN_EVENTS.RESTART,
          'agentLoop',
          hasAgentContext,
          restartBrain
        ) as any,
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
