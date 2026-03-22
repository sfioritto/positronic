import type { BRAIN_EVENTS, STATUS } from '../constants.js';
import type { JsonObject, JsonPatch, CurrentUser } from '../types.js';
import type { SerializedStepStatus } from './steps.js';
import type {
  SerializedWebhookRegistration,
  SerializedPageContext,
} from '../webhook.js';
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
  type: typeof BRAIN_EVENTS.START;
  initialState: object; // Always included now (no longer optional)
  status: typeof STATUS.RUNNING;
  currentUser: CurrentUser;
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

export interface BrainResumedEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.RESUMED;
  status: typeof STATUS.RUNNING;
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
  stepIndex: number; // 0-based index of the step within the current brain
}

export interface StepCompletedEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_COMPLETE;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
  patch: JsonPatch;
  halted?: boolean;
  pageContext?: SerializedPageContext;
}

// Webhook Event
export interface WebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK;
  waitFor: SerializedWebhookRegistration[];
  timeout?: number;
}

export interface WebhookResponseEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK_RESPONSE;
  response: JsonObject;
}

export interface IterateItemCompleteEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.ITERATE_ITEM_COMPLETE;
  stepTitle: string;
  stepId: string;
  itemIndex: number;
  item: any;
  result: any;
  processedCount: number;
  totalItems: number;
  stateKey: string;
  canRelease: boolean;
}

export interface FileWriteStartEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.FILE_WRITE_START;
  fileName: string;
  stepTitle: string;
}

export interface FileWriteCompleteEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.FILE_WRITE_COMPLETE;
  fileName: string;
  stepTitle: string;
}

// Prompt Loop Events
export interface PromptStartEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_START;
  stepTitle: string;
  stepId: string;
  prompt: string;
  system?: string;
  tools: string[];
}

export interface PromptIterationEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_ITERATION;
  stepTitle: string;
  stepId: string;
  iteration: number;
  tokensThisIteration: number;
  totalTokens: number;
}

export interface PromptToolCallEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_TOOL_CALL;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  iteration: number;
}

export interface PromptToolResultEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_TOOL_RESULT;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  result: unknown;
  iteration: number;
  status?: 'waiting_for_webhook';
}

export interface PromptAssistantMessageEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_ASSISTANT_MESSAGE;
  stepTitle: string;
  stepId: string;
  text: string;
  iteration: number;
}

export interface PromptCompleteEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_COMPLETE;
  stepTitle: string;
  stepId: string;
  result: unknown;
  terminalTool?: string;
  totalIterations: number;
  totalTokens: number;
}

export interface PromptTokenLimitEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_TOKEN_LIMIT;
  stepTitle: string;
  stepId: string;
  totalTokens: number;
  maxTokens: number;
}

export interface PromptIterationLimitEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_ITERATION_LIMIT;
  stepTitle: string;
  stepId: string;
  totalIterations: number;
  maxIterations: number;
}

export interface PromptRawResponseMessageEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_RAW_RESPONSE_MESSAGE;
  stepTitle: string;
  stepId: string;
  iteration: number;
  message: ResponseMessage[];
}

export interface PromptWebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.PROMPT_WEBHOOK;
  stepTitle: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

// Union type of all possible events
export type BrainEvent<TOptions extends JsonObject = JsonObject> =
  | BrainStartEvent<TOptions>
  | BrainCompleteEvent<TOptions>
  | BrainErrorEvent<TOptions>
  | BrainCancelledEvent<TOptions>
  | BrainPausedEvent<TOptions>
  | BrainResumedEvent<TOptions>
  | StepStatusEvent<TOptions>
  | StepStartedEvent<TOptions>
  | StepCompletedEvent<TOptions>
  | WebhookEvent<TOptions>
  | WebhookResponseEvent<TOptions>
  | IterateItemCompleteEvent<TOptions>
  | FileWriteStartEvent<TOptions>
  | FileWriteCompleteEvent<TOptions>
  | PromptStartEvent<TOptions>
  | PromptIterationEvent<TOptions>
  | PromptToolCallEvent<TOptions>
  | PromptToolResultEvent<TOptions>
  | PromptAssistantMessageEvent<TOptions>
  | PromptCompleteEvent<TOptions>
  | PromptTokenLimitEvent<TOptions>
  | PromptIterationLimitEvent<TOptions>
  | PromptRawResponseMessageEvent<TOptions>
  | PromptWebhookEvent<TOptions>;
