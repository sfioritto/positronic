import type { BRAIN_EVENTS, STATUS } from '../constants.js';
import type { JsonObject, JsonPatch } from '../types.js';
import type { SerializedStepStatus } from './steps.js';
import type { SerializedWebhookRegistration } from '../webhook.js';
import type { ResponseMessage } from '../../clients/types.js';

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

// Base event interface with only type and options
interface BaseEvent<TOptions extends JsonObject = JsonObject> {
  type: (typeof BRAIN_EVENTS)[keyof typeof BRAIN_EVENTS];
  options: TOptions;
  brainRunId: string;
}

// Brain Events (all include brain title/description)
interface BrainBaseEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  brainTitle: string;
  brainDescription?: string;
}

export interface BrainStartEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.START | typeof BRAIN_EVENTS.RESTART;
  initialState?: object;
  status: typeof STATUS.RUNNING;
}

export interface BrainCompleteEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.COMPLETE;
  status: typeof STATUS.COMPLETE;
}

export interface BrainErrorEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.ERROR;
  status: typeof STATUS.ERROR;
  error: SerializedError;
}

export interface BrainCancelledEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.CANCELLED;
  status: typeof STATUS.CANCELLED;
}

export interface BrainPausedEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PAUSED;
  status: typeof STATUS.PAUSED;
}

// Step Status Event (just steps array and base event properties)
export interface StepStatusEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_STATUS;
  steps: SerializedStepStatus[];
}

// Step Events (include step-specific properties)
export interface StepStartedEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_START;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
}

export interface StepCompletedEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_COMPLETE;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
  patch: JsonPatch;
}

export interface StepRetryEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_RETRY;
  stepTitle: string;
  stepId: string;
  error: SerializedError;
  attempt: number;
}

// Webhook Event
export interface WebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK;
  waitFor: SerializedWebhookRegistration[];
}

// Agent Events
export interface AgentStartEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_START;
  stepTitle: string;
  stepId: string;
  prompt: string;
  system?: string;
  tools?: string[];
}

export interface AgentIterationEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_ITERATION;
  stepTitle: string;
  stepId: string;
  iteration: number;
  tokensThisIteration: number;
  totalTokens: number;
}

export interface AgentToolCallEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_TOOL_CALL;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  input: JsonObject;
}

export interface AgentToolResultEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_TOOL_RESULT;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  result: unknown;
}

export interface AgentAssistantMessageEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE;
  stepTitle: string;
  stepId: string;
  content: string;
}

export interface AgentCompleteEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_COMPLETE;
  stepTitle: string;
  stepId: string;
  terminalToolName: string;
  result: JsonObject;
  totalIterations: number;
  totalTokens: number;
}

export interface AgentTokenLimitEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_TOKEN_LIMIT;
  stepTitle: string;
  stepId: string;
  totalTokens: number;
  maxTokens: number;
}

export interface AgentIterationLimitEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_ITERATION_LIMIT;
  stepTitle: string;
  stepId: string;
  iteration: number;
  maxIterations: number;
  totalTokens: number;
}

export interface AgentWebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_WEBHOOK;
  stepTitle: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  input: JsonObject;
}

export interface AgentRawResponseMessageEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE;
  stepTitle: string;
  stepId: string;
  iteration: number;
  /** A single SDK-native message preserving provider metadata (e.g., Gemini's thoughtSignature) */
  message: ResponseMessage;
}

export interface AgentUserMessageEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.AGENT_USER_MESSAGE;
  stepTitle: string;
  stepId: string;
  /** The user-injected message content */
  content: string;
}

export interface WebhookResponseEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK_RESPONSE;
  response: JsonObject;
}

// Union type of all possible events
export type BrainEvent<TOptions extends JsonObject = JsonObject> =
  | BrainStartEvent<TOptions>
  | BrainCompleteEvent<TOptions>
  | BrainErrorEvent<TOptions>
  | BrainCancelledEvent<TOptions>
  | BrainPausedEvent<TOptions>
  | StepStatusEvent<TOptions>
  | StepStartedEvent<TOptions>
  | StepCompletedEvent<TOptions>
  | StepRetryEvent<TOptions>
  | WebhookEvent<TOptions>
  | WebhookResponseEvent<TOptions>
  | AgentStartEvent<TOptions>
  | AgentIterationEvent<TOptions>
  | AgentToolCallEvent<TOptions>
  | AgentToolResultEvent<TOptions>
  | AgentAssistantMessageEvent<TOptions>
  | AgentCompleteEvent<TOptions>
  | AgentTokenLimitEvent<TOptions>
  | AgentIterationLimitEvent<TOptions>
  | AgentWebhookEvent<TOptions>
  | AgentRawResponseMessageEvent<TOptions>
  | AgentUserMessageEvent<TOptions>;
