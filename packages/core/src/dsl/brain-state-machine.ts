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

/**
 * ExecutionNode tracks state + position at a single nesting level.
 * Forms a tree structure for nested brains.
 */
export interface ExecutionNode {
  state: JsonObject;           // State at this brain level
  stepIndex: number;           // Current step index at this level (0-based)
  innerNode?: ExecutionNode;   // Child node if mid-inner-brain
}

export interface BrainStackEntry {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  parentStepId: string | null;
  steps: StepInfo[];
}

/**
 * Flat brain entry for the normalized brains map.
 * This is the source of truth - rootBrain tree is computed from this.
 */
export interface BrainEntry {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  parentStepId: string | null;
  parentBrainId: string | null;  // For tree reconstruction
  steps: StepInfo[];
  depth: number;
}

/**
 * Execution state entry for the execution stack.
 * Replaces the ExecutionNode tree with a flat stack.
 */
export interface ExecutionStackEntry {
  state: JsonObject;
  stepIndex: number;
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
  // === Flat storage (source of truth) ===
  // These are the authoritative data structures. O(1) access to current brain.
  brains: Record<string, BrainEntry>;     // All brains by ID (brainTitle used as key)
  brainIdStack: string[];                  // Stack of active brain IDs (current = last)
  executionStack: ExecutionStackEntry[];   // Stack of execution state per nesting level

  // === Core state ===
  depth: number;
  brainRunId: string | null;
  currentStepId: string | null;
  currentStepTitle: string | null;
  error: SerializedError | null;
  pendingWebhooks: WebhookRegistration[] | null;
  currentState: JsonObject;                // State at outer brain level (depth 1)
  options: JsonObject;                     // Options passed to the brain run

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
  stepIndex?: number;  // 0-based index of the step within the current brain
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
// Tree Reconstruction Helper (for consumers who need tree representation)
// ============================================================================

/**
 * Reconstruct the RunningBrain tree from flat brains map and stack.
 * Use this when you need a tree representation for UI rendering or debugging.
 * The flat structures (brains, brainIdStack) are the source of truth.
 */
export function reconstructBrainTree(
  brains: Record<string, BrainEntry>,
  brainIdStack: string[]
): RunningBrain | null {
  if (brainIdStack.length === 0) return null;

  let innerBrain: RunningBrain | null = null;

  // Build from deepest to root (reverse iteration)
  for (let i = brainIdStack.length - 1; i >= 0; i--) {
    const brainId = brainIdStack[i];
    const entry = brains[brainId];
    if (!entry) continue;

    innerBrain = {
      brainRunId: entry.brainRunId,
      brainTitle: entry.brainTitle,
      brainDescription: entry.brainDescription,
      parentStepId: entry.parentStepId,
      steps: entry.steps,
      innerBrain,
      depth: entry.depth,
    };
  }

  return innerBrain;
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
  // Flat storage (source of truth)
  brains: {},
  brainIdStack: [],
  executionStack: [],

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
      depth,
      brainRunId: existingBrainRunId,
      currentState,
      brains,
      brainIdStack,
      executionStack,
    } = ctx;

    const newDepth = depth + 1;
    const brainInitialState = initialState ?? currentState;

    // === NEW: Update flat structures ===
    const parentBrainId = brainIdStack.length > 0 ? brainIdStack[brainIdStack.length - 1] : null;
    const newBrainEntry: BrainEntry = {
      brainRunId,
      brainTitle,
      brainDescription,
      parentStepId: currentStepId,
      parentBrainId,
      steps: [],
      depth: newDepth,
    };

    const newBrains = { ...brains, [brainTitle]: newBrainEntry };
    const newBrainIdStack = [...brainIdStack, brainTitle];
    const newExecutionStack = [...executionStack, { state: brainInitialState, stepIndex: 0 }];

    const newCtx: BrainExecutionContext = {
      ...ctx,
      brains: newBrains,
      brainIdStack: newBrainIdStack,
      executionStack: newExecutionStack,
      depth: newDepth,
      brainRunId: existingBrainRunId ?? brainRunId,
      currentState: newDepth === 1 ? brainInitialState : currentState,
    };

    return updateDerivedState(newCtx, 'running');
  }
);

const completeBrain = reduce<BrainExecutionContext, object>((ctx) => {
  const { depth, brains, brainIdStack, executionStack } = ctx;

  if (brainIdStack.length === 0) return ctx;

  const newDepth = depth - 1;
  const isOuterBrainComplete = newDepth === 0;

  // === NEW: Update flat structures ===
  let newBrains = brains;
  let newBrainIdStack = brainIdStack;
  let newExecutionStack = executionStack;

  if (!isOuterBrainComplete) {
    // Pop the completed brain from stack
    const completedBrainId = brainIdStack[brainIdStack.length - 1];
    const completedBrain = brains[completedBrainId];
    newBrainIdStack = brainIdStack.slice(0, -1);
    newExecutionStack = executionStack.slice(0, -1);

    // Attach completed brain's steps to parent step
    if (completedBrain && newBrainIdStack.length > 0) {
      const parentBrainId = newBrainIdStack[newBrainIdStack.length - 1];
      const parentBrain = brains[parentBrainId];
      if (parentBrain && completedBrain.parentStepId) {
        const updatedSteps = parentBrain.steps.map((step) => {
          if (step.id === completedBrain.parentStepId) {
            return {
              ...step,
              innerSteps: completedBrain.steps,
              status: STATUS.COMPLETE as StepInfo['status'],
            };
          }
          return step;
        });
        newBrains = { ...brains, [parentBrainId]: { ...parentBrain, steps: updatedSteps } };
      }
    }
  }
  // If outer brain complete, keep everything as-is for final state display

  const newCtx: BrainExecutionContext = {
    ...ctx,
    brains: newBrains,
    brainIdStack: newBrainIdStack,
    executionStack: newExecutionStack,
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
  (ctx, { stepId, stepTitle, stepIndex }) => {
    const { brains, brainIdStack, executionStack } = ctx;

    if (brainIdStack.length === 0) return ctx;

    // === NEW: Update flat structures ===
    const currentBrainId = brainIdStack[brainIdStack.length - 1];
    const currentBrain = brains[currentBrainId];
    if (!currentBrain) return ctx;

    // Update current brain's steps
    const existingStep = currentBrain.steps.find((s) => s.id === stepId);
    const newSteps = existingStep
      ? currentBrain.steps.map((s) =>
          s.id === stepId ? { ...s, status: STATUS.RUNNING as StepInfo['status'] } : s
        )
      : [...currentBrain.steps, { id: stepId, title: stepTitle, status: STATUS.RUNNING as StepInfo['status'] }];

    const newBrains = {
      ...brains,
      [currentBrainId]: { ...currentBrain, steps: newSteps },
    };

    // Update stepIndex in execution stack if provided
    const newExecutionStack = stepIndex !== undefined && executionStack.length > 0
      ? [...executionStack.slice(0, -1), { ...executionStack[executionStack.length - 1], stepIndex }]
      : executionStack;

    return {
      ...ctx,
      brains: newBrains,
      executionStack: newExecutionStack,
      currentStepId: stepId,
      currentStepTitle: stepTitle,
    };
  }
);

const completeStep = reduce<BrainExecutionContext, CompleteStepPayload>(
  (ctx, { stepId, patch }) => {
    const {
      brains,
      brainIdStack,
      executionStack,
      depth,
      currentState,
      topLevelStepCount,
    } = ctx;

    if (brainIdStack.length === 0) return ctx;

    // === NEW: Update flat structures ===
    const currentBrainId = brainIdStack[brainIdStack.length - 1];
    const currentBrain = brains[currentBrainId];
    if (!currentBrain) return ctx;

    // Update step status
    const newSteps = currentBrain.steps.map((s) =>
      s.id === stepId ? { ...s, status: STATUS.COMPLETE as StepInfo['status'], patch } : s
    );

    const newBrains = {
      ...brains,
      [currentBrainId]: { ...currentBrain, steps: newSteps },
    };

    // Apply patch to execution stack and increment stepIndex
    let newExecutionStack = executionStack;
    if (executionStack.length > 0) {
      const topEntry = executionStack[executionStack.length - 1];
      const newState = patch
        ? applyPatches(topEntry.state, [patch]) as JsonObject
        : topEntry.state;
      // Increment stepIndex so resume knows to start from the NEXT step
      newExecutionStack = [...executionStack.slice(0, -1), {
        ...topEntry,
        state: newState,
        stepIndex: topEntry.stepIndex + 1,
      }];
    }

    // Apply patch to currentState only for top-level brain (for backwards compat)
    let newState = currentState;
    let newStepCount = topLevelStepCount;
    if (depth === 1 && patch) {
      newState = applyPatches(currentState, [patch]) as JsonObject;
      newStepCount = topLevelStepCount + 1;
    }

    return {
      ...ctx,
      brains: newBrains,
      executionStack: newExecutionStack,
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
    const { brains, brainIdStack } = ctx;

    if (brainIdStack.length === 0) return ctx;

    // === NEW: Update flat structures ===
    const currentBrainId = brainIdStack[brainIdStack.length - 1];
    const currentBrain = brains[currentBrainId];
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

    const newBrains = {
      ...brains,
      [currentBrainId]: { ...currentBrain, steps: newSteps },
    };

    return {
      ...ctx,
      brains: newBrains,
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
        transition(BRAIN_EVENTS.START, 'running', startBrain)
      ),

      // Standard step execution state
      running: state(
        // Nested brain lifecycle - always uses START
        transition(BRAIN_EVENTS.START, 'running', startBrain),

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
        // RESUMED transitions out of paused state without creating a new brain
        // If we have agentContext, resume to agentLoop; otherwise to running
        transition(
          BRAIN_EVENTS.RESUMED,
          'agentLoop',
          hasAgentContext,
          passthrough()
        ) as any,
        transition(BRAIN_EVENTS.RESUMED, 'running', passthrough()) as any,
        // START is kept for backwards compatibility but RESUMED is preferred
        transition(
          BRAIN_EVENTS.START,
          'agentLoop',
          hasAgentContext,
          startBrain
        ) as any,
        transition(BRAIN_EVENTS.START, 'running', startBrain) as any
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
        // START can resume from waiting (after webhook response is processed)
        // If we have agentContext, resume to agentLoop; otherwise to running
        transition(
          BRAIN_EVENTS.START,
          'agentLoop',
          hasAgentContext,
          startBrain
        ) as any,
        transition(BRAIN_EVENTS.START, 'running', startBrain) as any
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

