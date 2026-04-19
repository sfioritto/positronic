import * as robot3 from 'robot3';
// Use namespace import to work around ESM/CJS interop issues with robot3.
// When installed globally or on different Node.js versions, the package may
// resolve to its CJS entry point which doesn't properly expose named exports.
const { createMachine, state, transition, reduce, guard, interpret } = robot3;
import { BRAIN_EVENTS, STATUS } from './constants.js';
import { applyPatches } from './json-patch.js';
import type { JsonPatch, JsonObject } from './types.js';
import type { SerializedPageContext } from './webhook.js';
import type { ResponseMessage } from '../clients/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Flat brain entry for the normalized brains map.
 * This is the source of truth - rootBrain tree is computed from this.
 */
export interface BrainEntry {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  options?: JsonObject;
  parentStepId: string | null;
  parentBrainId: string | null; // For tree reconstruction
  steps: StepInfo[];
  depth: number;
}

/**
 * Execution state entry for the execution stack.
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
  options?: JsonObject;
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
 * Context for tracking iterate execution state across pause/resume cycles.
 * Accumulates per-item results so the iteration can resume from where it left off.
 */
export interface IterateContext {
  stepId: string;
  accumulatedResults: ({ item: any; result: any } | undefined)[];
  processedCount: number;
  totalItems: number;
  stateKey: string;
}

/**
 * Context for tracking prompt loop execution state across pause/resume cycles.
 * Preserves conversation history so the loop can resume from where it left off.
 */
export interface PromptLoopContext {
  stepId: string;
  stepTitle: string;
  prompt: string;
  system?: string;
  responseMessages: ResponseMessage[];
  pendingToolCallId: string | null;
  pendingToolName: string | null;
  iteration: number;
  totalTokens: number;
}

export interface BrainExecutionContext {
  // === Flat storage (source of truth) ===
  // These are the authoritative data structures. O(1) access to current brain.
  brains: Record<string, BrainEntry>; // All brains by ID (brainTitle used as key)
  brainIdStack: string[]; // Stack of active brain IDs (current = last)
  executionStack: ExecutionStackEntry[]; // Stack of execution state per nesting level

  // === Core state ===
  depth: number;
  brainRunId: string | null;
  currentStepId: string | null;
  currentStepTitle: string | null;
  error: SerializedError | null;
  pendingWebhooks: WebhookRegistration[] | null;
  currentState: JsonObject; // State at outer brain level (depth 1)
  options: JsonObject; // Options passed to the brain run

  // Iterate context - tracks iterate execution state for pause/resume
  // Non-null when we're inside an iterate step (or paused from one)
  iterateContext: IterateContext | null;

  // Prompt loop context - tracks prompt loop execution state for pause/resume
  // Non-null when we're inside a prompt loop (or paused/waiting from one)
  promptLoopContext: PromptLoopContext | null;

  // Page context - tracks the current page from a read-only page step.
  // Set when a page step completes with pageContext (read-only page, no outputSchema).
  // Used for resume when a .wait() follows a read-only .page() step.
  currentPage: SerializedPageContext | null;

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
  options?: JsonObject;
  initialState?: JsonObject;
}

export interface StartStepPayload {
  stepId: string;
  stepTitle: string;
  stepIndex?: number; // 0-based index of the step within the current brain
}

export interface CompleteStepPayload {
  stepId: string;
  stepTitle: string;
  patch?: JsonPatch;
  halted?: boolean;
  pageContext?: SerializedPageContext;
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
      options: entry.options,
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
  iterateContext: null,
  promptLoopContext: null,
  currentPage: null,
  status: STATUS.PENDING,
  isTopLevel: false,
  isRunning: false,
  isComplete: false,
  isPaused: false,
  isWaiting: false,
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
  (
    ctx,
    { brainRunId, brainTitle, brainDescription, options, initialState }
  ) => {
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
    const parentBrainId =
      brainIdStack.length > 0 ? brainIdStack[brainIdStack.length - 1] : null;
    const newBrainEntry: BrainEntry = {
      brainRunId,
      brainTitle,
      brainDescription,
      options,
      parentStepId: currentStepId,
      parentBrainId,
      steps: [],
      depth: newDepth,
    };

    const newBrains = { ...brains, [brainTitle]: newBrainEntry };
    const newBrainIdStack = [...brainIdStack, brainTitle];
    const newExecutionStack = [
      ...executionStack,
      { state: brainInitialState, stepIndex: 0 },
    ];

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
        newBrains = {
          ...brains,
          [parentBrainId]: { ...parentBrain, steps: updatedSteps },
        };
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

  return updateDerivedState(
    newCtx,
    isOuterBrainComplete ? 'complete' : 'running'
  );
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

const completeInnerBrainError = reduce<BrainExecutionContext, ErrorPayload>(
  (ctx, { error }) => {
    const { depth, brainIdStack, executionStack } = ctx;

    if (brainIdStack.length === 0) return ctx;

    const newCtx: BrainExecutionContext = {
      ...ctx,
      brainIdStack: brainIdStack.slice(0, -1),
      executionStack: executionStack.slice(0, -1),
      depth: depth - 1,
      error,
    };

    return updateDerivedState(newCtx, 'running');
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
          s.id === stepId
            ? { ...s, status: STATUS.RUNNING as StepInfo['status'] }
            : s
        )
      : [
          ...currentBrain.steps,
          {
            id: stepId,
            title: stepTitle,
            status: STATUS.RUNNING as StepInfo['status'],
          },
        ];

    const newBrains = {
      ...brains,
      [currentBrainId]: { ...currentBrain, steps: newSteps },
    };

    // Update stepIndex in execution stack if provided
    const newExecutionStack =
      stepIndex !== undefined && executionStack.length > 0
        ? [
            ...executionStack.slice(0, -1),
            { ...executionStack[executionStack.length - 1], stepIndex },
          ]
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
  (ctx, { stepId, stepTitle, patch, halted, pageContext }) => {
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

    // Use explicit halted flag from the event
    const isHalted = halted === true;

    // Update step status - HALTED if explicitly marked, COMPLETE otherwise
    const stepStatus = isHalted ? STATUS.HALTED : STATUS.COMPLETE;
    const existingStep = currentBrain.steps.find((s) => s.id === stepId);
    const newSteps = existingStep
      ? currentBrain.steps.map((s) =>
          s.id === stepId
            ? { ...s, status: stepStatus as StepInfo['status'], patch }
            : s
        )
      : [
          ...currentBrain.steps,
          {
            id: stepId,
            title: stepTitle,
            status: stepStatus as StepInfo['status'],
            patch,
          },
        ];

    const newBrains = {
      ...brains,
      [currentBrainId]: { ...currentBrain, steps: newSteps },
    };

    // Apply patch to execution stack and increment stepIndex
    let newExecutionStack = executionStack;
    if (executionStack.length > 0) {
      const topEntry = executionStack[executionStack.length - 1];
      const newState =
        patch && !isHalted
          ? (applyPatches(topEntry.state, [patch]) as JsonObject)
          : topEntry.state;
      // Increment stepIndex so resume knows to start from the NEXT step
      newExecutionStack = [
        ...executionStack.slice(0, -1),
        {
          ...topEntry,
          state: newState,
          stepIndex: topEntry.stepIndex + 1,
        },
      ];
    }

    // Apply patch to currentState only for top-level brain (for backwards compat)
    // Skipped steps don't change state or count toward topLevelStepCount
    let newState = currentState;
    let newStepCount = topLevelStepCount;
    if (depth === 1 && patch && !isHalted) {
      newState = applyPatches(currentState, [patch]) as JsonObject;
      newStepCount = topLevelStepCount + 1;
    }

    // Only clear iterateContext when the iterate step itself completes,
    // not when inner brain steps complete during iteration
    const newIterateContext =
      ctx.iterateContext?.stepId === stepId ? null : ctx.iterateContext;

    // Clear promptLoopContext when the prompt step completes
    const newPromptLoopContext =
      ctx.promptLoopContext?.stepId === stepId ? null : ctx.promptLoopContext;

    // Track page context: set when page step completes (has pageContext),
    // clear when the next step completes (page is ephemeral)
    const newCurrentPage = pageContext ?? null;

    return {
      ...ctx,
      brains: newBrains,
      executionStack: newExecutionStack,
      currentState: newState,
      topLevelStepCount: newStepCount,
      iterateContext: newIterateContext,
      promptLoopContext: newPromptLoopContext,
      currentPage: newCurrentPage,
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

const resumeBrain = reduce<BrainExecutionContext, object>((ctx) => {
  return updateDerivedState(ctx, 'running');
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

// Reducer for ITERATE_ITEM_COMPLETE - appends a single item result into iterateContext
const iterateItemComplete = reduce<BrainExecutionContext, any>(
  (ctx, payload) => {
    const existing = ctx.iterateContext;
    const newResults = existing?.accumulatedResults
      ? [...existing.accumulatedResults]
      : [];
    newResults[payload.itemIndex] =
      payload.result != null
        ? { item: payload.item, result: payload.result }
        : undefined;
    return {
      ...ctx,
      iterateContext: {
        stepId: payload.stepId,
        accumulatedResults: newResults,
        processedCount: payload.processedCount,
        totalItems: payload.totalItems,
        stateKey: payload.stateKey,
      },
    };
  }
);

// Prompt loop payload types

interface PromptStartPayload {
  stepId: string;
  stepTitle: string;
  prompt: string;
  system?: string;
}

interface PromptIterationPayload {
  iteration: number;
  totalTokens: number;
}

interface PromptRawMessagePayload {
  message: ResponseMessage[];
}

interface PromptWebhookPayload {
  toolCallId: string;
  toolName: string;
}

// Prompt loop reducers
// responseMessages and pendingToolCallId/Name are tracked here because on
// resume the DO replays persisted events through a fresh state machine to
// reconstruct context, then runner.resume() extracts promptLoopContext to
// pass into the new event stream's ResumeParams.

const promptStart = reduce<BrainExecutionContext, PromptStartPayload>(
  (ctx, { stepId, stepTitle, prompt, system }) => ({
    ...ctx,
    promptLoopContext: {
      stepId,
      stepTitle,
      prompt,
      system,
      responseMessages: [],
      pendingToolCallId: null,
      pendingToolName: null,
      iteration: 0,
      totalTokens: 0,
    },
  })
);

const promptIteration = reduce<BrainExecutionContext, PromptIterationPayload>(
  (ctx, { iteration, totalTokens }) => {
    if (!ctx.promptLoopContext) return ctx;
    return {
      ...ctx,
      promptLoopContext: {
        ...ctx.promptLoopContext,
        iteration,
        totalTokens,
      },
    };
  }
);

const promptRawMessage = reduce<BrainExecutionContext, PromptRawMessagePayload>(
  (ctx, { message }) => {
    if (!ctx.promptLoopContext) return ctx;
    // Replace, don't append — each emission carries the full conversation
    // history from generateText (the SDK accumulates internally)
    return {
      ...ctx,
      promptLoopContext: {
        ...ctx.promptLoopContext,
        responseMessages: message,
      },
    };
  }
);

const promptWebhook = reduce<BrainExecutionContext, PromptWebhookPayload>(
  (ctx, { toolCallId, toolName }) => {
    if (!ctx.promptLoopContext) return ctx;
    return {
      ...ctx,
      promptLoopContext: {
        ...ctx.promptLoopContext,
        pendingToolCallId: toolCallId,
        pendingToolName: toolName,
      },
    };
  }
);

const promptComplete = reduce<BrainExecutionContext, object>((ctx) => ({
  ...ctx,
  promptLoopContext: null,
}));

const passthrough = reduce<BrainExecutionContext, object>((ctx) => ctx);

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
      idle: state(transition(BRAIN_EVENTS.START, 'running', startBrain)),

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
        // Inner brain error -> stay running (pop the inner brain off the stack)
        transition(
          BRAIN_EVENTS.ERROR,
          'running',
          isInnerBrain,
          completeInnerBrainError
        ) as any,

        // Cancelled
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,

        // Paused (by signal)
        transition(BRAIN_EVENTS.PAUSED, 'paused', pauseBrain) as any,

        // Webhook -> waiting
        transition(BRAIN_EVENTS.WEBHOOK, 'waiting', webhookPause) as any,

        // Webhook response
        transition(
          BRAIN_EVENTS.WEBHOOK_RESPONSE,
          'running',
          webhookResponse
        ) as any,

        // Step events
        transition(BRAIN_EVENTS.STEP_START, 'running', startStep) as any,
        transition(BRAIN_EVENTS.STEP_COMPLETE, 'running', completeStep) as any,
        transition(BRAIN_EVENTS.STEP_STATUS, 'running', stepStatus) as any,

        // Iterate item complete - stays in running, accumulates results
        transition(
          BRAIN_EVENTS.ITERATE_ITEM_COMPLETE,
          'running',
          iterateItemComplete
        ) as any,

        // Prompt loop events - stay in running, update promptLoopContext
        transition(BRAIN_EVENTS.PROMPT_START, 'running', promptStart) as any,
        transition(
          BRAIN_EVENTS.PROMPT_ITERATION,
          'running',
          promptIteration
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_TOOL_CALL,
          'running',
          passthrough
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_TOOL_RESULT,
          'running',
          passthrough
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_ASSISTANT_MESSAGE,
          'running',
          passthrough
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_COMPLETE,
          'running',
          promptComplete
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_TOKEN_LIMIT,
          'running',
          promptComplete
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_ITERATION_LIMIT,
          'running',
          promptComplete
        ) as any,
        transition(
          BRAIN_EVENTS.PROMPT_RAW_RESPONSE_MESSAGE,
          'running',
          promptRawMessage
        ) as any,
        transition(BRAIN_EVENTS.PROMPT_WEBHOOK, 'running', promptWebhook) as any
      ),

      paused: state(
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,
        // RESUMED transitions out of paused state without creating a new brain
        transition(BRAIN_EVENTS.RESUMED, 'running', resumeBrain) as any,
        // START is kept for backwards compatibility but RESUMED is preferred
        transition(BRAIN_EVENTS.START, 'running', startBrain) as any
      ),

      waiting: state(
        // TODO: Could add PAUSED transition here to allow pausing a waiting brain.
        // This would require queueing webhook responses (similar to USER_MESSAGE signals)
        // so they can be processed when the brain is resumed.
        transition(BRAIN_EVENTS.WEBHOOK_RESPONSE, 'running', webhookResponse),
        transition(BRAIN_EVENTS.CANCELLED, 'cancelled', cancelBrain) as any,
        // RESUMED transitions out of waiting (e.g., timeout-triggered wakeUp with no webhook response)
        transition(BRAIN_EVENTS.RESUMED, 'running', resumeBrain) as any,
        // START can resume from waiting (after webhook response is processed)
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

/**
 * Export a machine instance for signal validation.
 * This is created once and used to query valid transitions.
 * The machine is created with default initial context - only the state definitions matter for validation.
 */
export const brainMachineDefinition = makeBrainMachine(createInitialContext());
