import {
  createMachine,
  state,
  transition,
  reduce,
  guard,
  interpret,
} from 'robot3';
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
  isTopLevel: boolean;
  isRunning: boolean;
  isComplete: boolean;
  isPaused: boolean;
  isError: boolean;
  isCancelled: boolean;

  // Step counter for top-level steps
  topLevelStepCount: number;
}

export type ExecutionState = 'idle' | 'running' | 'paused' | 'complete' | 'error' | 'cancelled';

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
  state?: JsonObject;
}

export interface ErrorPayload {
  error: SerializedError;
}

export interface StepStatusPayload {
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
}

const createInitialContext = (opts?: CreateMachineOptions): BrainExecutionContext => ({
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

const updateDerivedState = (ctx: BrainExecutionContext, executionState: ExecutionState): BrainExecutionContext => ({
  ...ctx,
  isTopLevel: ctx.depth === 1,
  isRunning: executionState === 'running',
  isComplete: executionState === 'complete',
  isPaused: executionState === 'paused',
  isError: executionState === 'error',
  isCancelled: executionState === 'cancelled',
});

// ============================================================================
// Reducers - Update context on transitions
// ============================================================================

const startBrain = reduce<BrainExecutionContext, StartBrainPayload>((ctx, ev) => {
  const newEntry: BrainStackEntry = {
    brainRunId: ev.brainRunId,
    brainTitle: ev.brainTitle,
    brainDescription: ev.brainDescription,
    parentStepId: ctx.currentStepId,
    steps: [],
  };

  const newDepth = ctx.depth + 1;
  const newCtx: BrainExecutionContext = {
    ...ctx,
    brainStack: [...ctx.brainStack, newEntry],
    depth: newDepth,
    brainRunId: ctx.brainRunId ?? ev.brainRunId,
    currentState: newDepth === 1 ? (ev.initialState ?? ctx.currentState) : ctx.currentState,
    currentEvent: {
      type: BRAIN_EVENTS.START,
      brainTitle: ev.brainTitle,
      brainDescription: ev.brainDescription,
      brainRunId: ev.brainRunId,
      initialState: ev.initialState ?? {},
      status: STATUS.RUNNING,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'running');
});

const restartBrain = reduce<BrainExecutionContext, StartBrainPayload>((ctx, ev) => {
  const newEntry: BrainStackEntry = {
    brainRunId: ev.brainRunId,
    brainTitle: ev.brainTitle,
    brainDescription: ev.brainDescription,
    parentStepId: ctx.currentStepId,
    steps: [],
  };

  const newDepth = ctx.depth + 1;
  const newCtx: BrainExecutionContext = {
    ...ctx,
    brainStack: [...ctx.brainStack, newEntry],
    depth: newDepth,
    brainRunId: ctx.brainRunId ?? ev.brainRunId,
    currentEvent: {
      type: BRAIN_EVENTS.RESTART,
      brainTitle: ev.brainTitle,
      brainDescription: ev.brainDescription,
      brainRunId: ev.brainRunId,
      initialState: ev.initialState ?? {},
      status: STATUS.RUNNING,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'running');
});

const completeBrain = reduce<BrainExecutionContext, object>((ctx) => {
  if (ctx.brainStack.length === 0) return ctx;

  const completedBrain = ctx.brainStack[ctx.brainStack.length - 1];
  const newStack = ctx.brainStack.slice(0, -1);

  // Attach completed brain's steps to parent step if nested
  if (newStack.length > 0 && completedBrain.parentStepId) {
    const parentBrain = newStack[newStack.length - 1];
    const parentStep = parentBrain.steps.find((s) => s.id === completedBrain.parentStepId);
    if (parentStep) {
      parentStep.innerSteps = completedBrain.steps;
      parentStep.status = STATUS.COMPLETE;
    }
  }

  const newDepth = ctx.depth - 1;
  const isNowComplete = newDepth === 0;

  const newCtx: BrainExecutionContext = {
    ...ctx,
    brainStack: newStack,
    depth: newDepth,
    currentEvent: {
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: completedBrain.brainTitle,
      brainDescription: completedBrain.brainDescription,
      brainRunId: ctx.brainRunId!,
      status: STATUS.COMPLETE,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, isNowComplete ? 'complete' : 'running');
});

const errorBrain = reduce<BrainExecutionContext, ErrorPayload>((ctx, ev) => {
  const currentBrain = ctx.brainStack[ctx.brainStack.length - 1];

  const newCtx: BrainExecutionContext = {
    ...ctx,
    error: ev.error,
    currentEvent: {
      type: BRAIN_EVENTS.ERROR,
      brainTitle: currentBrain?.brainTitle,
      brainDescription: currentBrain?.brainDescription,
      brainRunId: ctx.brainRunId!,
      error: ev.error,
      status: STATUS.ERROR,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'error');
});

const cancelBrain = reduce<BrainExecutionContext, object>((ctx) => {
  const currentBrain = ctx.brainStack[ctx.brainStack.length - 1];

  const newCtx: BrainExecutionContext = {
    ...ctx,
    currentEvent: {
      type: BRAIN_EVENTS.CANCELLED,
      brainTitle: currentBrain?.brainTitle,
      brainDescription: currentBrain?.brainDescription,
      brainRunId: ctx.brainRunId!,
      status: STATUS.CANCELLED,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'cancelled');
});

const startStep = reduce<BrainExecutionContext, StartStepPayload>((ctx, ev) => {
  // Add step to current brain's steps if not already there
  if (ctx.brainStack.length > 0) {
    const currentBrain = ctx.brainStack[ctx.brainStack.length - 1];
    const existingStep = currentBrain.steps.find((s) => s.id === ev.stepId);
    if (!existingStep) {
      currentBrain.steps.push({
        id: ev.stepId,
        title: ev.stepTitle,
        status: STATUS.RUNNING,
      });
    } else {
      existingStep.status = STATUS.RUNNING;
    }
  }

  return {
    ...ctx,
    currentStepId: ev.stepId,
    currentStepTitle: ev.stepTitle,
    currentEvent: {
      type: BRAIN_EVENTS.STEP_START,
      brainRunId: ctx.brainRunId!,
      stepId: ev.stepId,
      stepTitle: ev.stepTitle,
      status: STATUS.RUNNING,
      options: ctx.options,
    },
  };
});

const completeStep = reduce<BrainExecutionContext, CompleteStepPayload>((ctx, ev) => {
  if (ctx.brainStack.length > 0) {
    const currentBrain = ctx.brainStack[ctx.brainStack.length - 1];
    const step = currentBrain.steps.find((s) => s.id === ev.stepId);
    if (step) {
      step.status = STATUS.COMPLETE;
      step.patch = ev.patch;
    }
  }

  // Apply patch to currentState only for top-level brain
  let newState = ctx.currentState;
  let newStepCount = ctx.topLevelStepCount;
  if (ctx.depth === 1 && ev.patch) {
    newState = applyPatches(ctx.currentState, [ev.patch]) as JsonObject;
    newStepCount = ctx.topLevelStepCount + 1;
  }

  return {
    ...ctx,
    currentState: newState,
    topLevelStepCount: newStepCount,
    currentEvent: {
      type: BRAIN_EVENTS.STEP_COMPLETE,
      brainRunId: ctx.brainRunId!,
      stepId: ev.stepId,
      stepTitle: ev.stepTitle,
      patch: ev.patch,
      status: STATUS.RUNNING,
      options: ctx.options,
    },
  };
});

const webhookPause = reduce<BrainExecutionContext, WebhookPayload>((ctx, ev) => {
  const newCtx: BrainExecutionContext = {
    ...ctx,
    pendingWebhooks: ev.waitFor,
    currentEvent: {
      type: BRAIN_EVENTS.WEBHOOK,
      brainRunId: ctx.brainRunId!,
      waitFor: ev.waitFor,
      state: ev.state ?? ctx.currentState,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'paused');
});

const webhookResponse = reduce<BrainExecutionContext, { response: JsonObject }>((ctx, ev) => {
  const newCtx: BrainExecutionContext = {
    ...ctx,
    pendingWebhooks: null,
    currentEvent: {
      type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
      brainRunId: ctx.brainRunId!,
      response: ev.response,
      options: ctx.options,
    },
  };

  return updateDerivedState(newCtx, 'running');
});

const stepStatus = reduce<BrainExecutionContext, StepStatusPayload>((ctx, ev) => ({
  ...ctx,
  currentEvent: {
    type: BRAIN_EVENTS.STEP_STATUS,
    brainRunId: ctx.brainRunId!,
    steps: ev.steps,
    options: ctx.options,
  },
}));

const stepRetry = reduce<BrainExecutionContext, StepRetryPayload>((ctx, ev) => ({
  ...ctx,
  currentEvent: {
    type: BRAIN_EVENTS.STEP_RETRY,
    brainRunId: ctx.brainRunId!,
    stepId: ev.stepId,
    stepTitle: ev.stepTitle,
    error: ev.error,
    attempt: ev.attempt,
    options: ctx.options,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const passthrough = (eventType: string) => reduce<BrainExecutionContext, any>((ctx, ev) => {
  // Destructure to exclude 'type' (the action name) from being spread into currentEvent
  const { type: _actionType, ...eventData } = ev;
  return {
    ...ctx,
    currentEvent: {
      type: eventType,
      brainRunId: ctx.brainRunId!,
      options: ctx.options,
      ...eventData,
    },
  };
});

// ============================================================================
// Guards - Conditional transitions
// ============================================================================

const isOuterBrain = guard<BrainExecutionContext, object>((ctx) => ctx.depth === 1);
const isInnerBrain = guard<BrainExecutionContext, object>((ctx) => ctx.depth > 1);

// ============================================================================
// State Machine Definition
// ============================================================================

// Action names for transitions
const ACTIONS = {
  START_BRAIN: 'startBrain',
  RESTART_BRAIN: 'restartBrain',
  COMPLETE_BRAIN: 'completeBrain',
  ERROR_BRAIN: 'errorBrain',
  CANCEL_BRAIN: 'cancelBrain',
  WEBHOOK: 'webhook',
  WEBHOOK_RESPONSE: 'webhookResponse',
  START_STEP: 'startStep',
  COMPLETE_STEP: 'completeStep',
  STEP_STATUS: 'stepStatus',
  STEP_RETRY: 'stepRetry',
  LOOP_START: 'loopStart',
  LOOP_ITERATION: 'loopIteration',
  LOOP_TOOL_CALL: 'loopToolCall',
  LOOP_TOOL_RESULT: 'loopToolResult',
  LOOP_ASSISTANT_MESSAGE: 'loopAssistantMessage',
  LOOP_COMPLETE: 'loopComplete',
  LOOP_TOKEN_LIMIT: 'loopTokenLimit',
  LOOP_WEBHOOK: 'loopWebhook',
  HEARTBEAT: 'heartbeat',
} as const;

export { ACTIONS as BRAIN_ACTIONS };

// Create machine factory - needs to be called with initial context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createBrainMachine = (initialContext: BrainExecutionContext): any =>
  createMachine(
    'idle',
    {
      idle: state(
        transition(ACTIONS.START_BRAIN, 'running', startBrain),
        transition(ACTIONS.RESTART_BRAIN, 'running', restartBrain) as any
      ),

      running: state(
        // Nested brain lifecycle
        transition(ACTIONS.START_BRAIN, 'running', startBrain),
        transition(ACTIONS.RESTART_BRAIN, 'running', restartBrain) as any,

        // Outer brain complete -> terminal
        transition(ACTIONS.COMPLETE_BRAIN, 'complete', isOuterBrain, completeBrain) as any,
        // Inner brain complete -> stay running
        transition(ACTIONS.COMPLETE_BRAIN, 'running', isInnerBrain, completeBrain) as any,

        // Error (only outer brain errors are terminal)
        transition(ACTIONS.ERROR_BRAIN, 'error', isOuterBrain, errorBrain) as any,

        // Cancelled
        transition(ACTIONS.CANCEL_BRAIN, 'cancelled', cancelBrain) as any,

        // Webhook -> paused
        transition(ACTIONS.WEBHOOK, 'paused', webhookPause) as any,

        // Webhook response (for resume from webhook - machine is already running)
        transition(ACTIONS.WEBHOOK_RESPONSE, 'running', webhookResponse) as any,

        // Step events
        transition(ACTIONS.START_STEP, 'running', startStep) as any,
        transition(ACTIONS.COMPLETE_STEP, 'running', completeStep) as any,
        transition(ACTIONS.STEP_STATUS, 'running', stepStatus) as any,
        transition(ACTIONS.STEP_RETRY, 'running', stepRetry) as any,

        // Loop events (pass-through with event data)
        transition(ACTIONS.LOOP_START, 'running', passthrough(BRAIN_EVENTS.LOOP_START)) as any,
        transition(ACTIONS.LOOP_ITERATION, 'running', passthrough(BRAIN_EVENTS.LOOP_ITERATION)) as any,
        transition(ACTIONS.LOOP_TOOL_CALL, 'running', passthrough(BRAIN_EVENTS.LOOP_TOOL_CALL)) as any,
        transition(ACTIONS.LOOP_TOOL_RESULT, 'running', passthrough(BRAIN_EVENTS.LOOP_TOOL_RESULT)) as any,
        transition(ACTIONS.LOOP_ASSISTANT_MESSAGE, 'running', passthrough(BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE)) as any,
        transition(ACTIONS.LOOP_COMPLETE, 'running', passthrough(BRAIN_EVENTS.LOOP_COMPLETE)) as any,
        transition(ACTIONS.LOOP_TOKEN_LIMIT, 'running', passthrough(BRAIN_EVENTS.LOOP_TOKEN_LIMIT)) as any,
        transition(ACTIONS.LOOP_WEBHOOK, 'running', passthrough(BRAIN_EVENTS.LOOP_WEBHOOK)) as any,
        transition(ACTIONS.HEARTBEAT, 'running', passthrough(BRAIN_EVENTS.HEARTBEAT)) as any
      ),

      paused: state(
        transition(ACTIONS.WEBHOOK_RESPONSE, 'running', webhookResponse),
        transition(ACTIONS.CANCEL_BRAIN, 'cancelled', cancelBrain) as any,
        // RESTART happens when resuming from webhook
        transition(ACTIONS.RESTART_BRAIN, 'running', restartBrain) as any
      ),

      // Terminal states - limited outgoing transitions
      complete: state(),
      error: state(
        // Allow STEP_STATUS after error so we can emit the final step statuses
        transition(ACTIONS.STEP_STATUS, 'error', stepStatus) as any
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
 */
export function createBrainExecutionMachine(options?: CreateMachineOptions): BrainStateMachine {
  const initialContext = createInitialContext(options);
  const machine = createBrainMachine(initialContext);
  return interpret(machine, () => {});
}

/**
 * Send a transition action to the machine.
 * After calling this, read machine.context.currentEvent to get the event to yield.
 */
export function sendAction(
  machine: BrainStateMachine,
  action: string,
  payload?: object
): void {
  machine.send({ type: action, ...payload });
}

/**
 * Feed an incoming event into the machine to update state (observer mode).
 * Maps brain event types to machine actions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sendEvent(machine: BrainStateMachine, event: { type: string } & Record<string, any>): void {
  const eventToAction: Record<string, string> = {
    [BRAIN_EVENTS.START]: ACTIONS.START_BRAIN,
    [BRAIN_EVENTS.RESTART]: ACTIONS.RESTART_BRAIN,
    [BRAIN_EVENTS.COMPLETE]: ACTIONS.COMPLETE_BRAIN,
    [BRAIN_EVENTS.ERROR]: ACTIONS.ERROR_BRAIN,
    [BRAIN_EVENTS.CANCELLED]: ACTIONS.CANCEL_BRAIN,
    [BRAIN_EVENTS.WEBHOOK]: ACTIONS.WEBHOOK,
    [BRAIN_EVENTS.WEBHOOK_RESPONSE]: ACTIONS.WEBHOOK_RESPONSE,
    [BRAIN_EVENTS.STEP_START]: ACTIONS.START_STEP,
    [BRAIN_EVENTS.STEP_COMPLETE]: ACTIONS.COMPLETE_STEP,
    [BRAIN_EVENTS.STEP_STATUS]: ACTIONS.STEP_STATUS,
    [BRAIN_EVENTS.STEP_RETRY]: ACTIONS.STEP_RETRY,
    [BRAIN_EVENTS.LOOP_START]: ACTIONS.LOOP_START,
    [BRAIN_EVENTS.LOOP_ITERATION]: ACTIONS.LOOP_ITERATION,
    [BRAIN_EVENTS.LOOP_TOOL_CALL]: ACTIONS.LOOP_TOOL_CALL,
    [BRAIN_EVENTS.LOOP_TOOL_RESULT]: ACTIONS.LOOP_TOOL_RESULT,
    [BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE]: ACTIONS.LOOP_ASSISTANT_MESSAGE,
    [BRAIN_EVENTS.LOOP_COMPLETE]: ACTIONS.LOOP_COMPLETE,
    [BRAIN_EVENTS.LOOP_TOKEN_LIMIT]: ACTIONS.LOOP_TOKEN_LIMIT,
    [BRAIN_EVENTS.LOOP_WEBHOOK]: ACTIONS.LOOP_WEBHOOK,
    [BRAIN_EVENTS.HEARTBEAT]: ACTIONS.HEARTBEAT,
  };

  const action = eventToAction[event.type];
  if (action) {
    const payload = extractPayloadFromEvent(event);
    machine.send({ type: action, ...payload });
  }
}

/**
 * Extract relevant payload fields from a brain event for the state machine.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPayloadFromEvent(event: { type: string } & Record<string, any>): object {
  switch (event.type) {
    case BRAIN_EVENTS.START:
    case BRAIN_EVENTS.RESTART:
      return {
        brainRunId: event.brainRunId,
        brainTitle: event.brainTitle,
        brainDescription: event.brainDescription,
        initialState: event.initialState,
      };
    case BRAIN_EVENTS.STEP_START:
      return {
        stepId: event.stepId,
        stepTitle: event.stepTitle,
      };
    case BRAIN_EVENTS.STEP_COMPLETE:
      return {
        stepId: event.stepId,
        stepTitle: event.stepTitle,
        patch: event.patch,
      };
    case BRAIN_EVENTS.ERROR:
      return {
        error: event.error,
      };
    case BRAIN_EVENTS.WEBHOOK:
      return {
        waitFor: event.waitFor,
        state: event.state,
      };
    case BRAIN_EVENTS.WEBHOOK_RESPONSE:
      return {
        response: event.response,
      };
    case BRAIN_EVENTS.STEP_STATUS:
      return {
        steps: event.steps,
      };
    case BRAIN_EVENTS.STEP_RETRY:
      return {
        stepId: event.stepId,
        stepTitle: event.stepTitle,
        error: event.error,
        attempt: event.attempt,
      };
    default:
      // For pass-through events, pass all properties except type
      const { type, ...rest } = event;
      return rest;
  }
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
  const ctx = machine.context;
  if (ctx.brainStack.length === 0 || !ctx.currentStepId) return null;

  const currentBrain = ctx.brainStack[ctx.brainStack.length - 1];
  return currentBrain.steps.find((s) => s.id === ctx.currentStepId) ?? null;
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

export function getPendingWebhooks(machine: BrainStateMachine): WebhookRegistration[] | null {
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
