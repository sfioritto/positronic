// Re-export from new modular structure for backwards compatibility

// Builder
export { Brain, brain } from './builder/brain.js';

// Definitions - Events
export type {
  SerializedError,
  BrainStartEvent,
  BrainCompleteEvent,
  BrainErrorEvent,
  BrainCancelledEvent,
  StepStatusEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepRetryEvent,
  WebhookEvent,
  AgentStartEvent,
  AgentIterationEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentAssistantMessageEvent,
  AgentCompleteEvent,
  AgentTokenLimitEvent,
  AgentWebhookEvent,
  WebhookResponseEvent,
  BrainEvent,
} from './definitions/events.js';

// Definitions - Steps
export type {
  SerializedStep,
  SerializedStepStatus,
  BrainStructure,
} from './definitions/steps.js';

// Definitions - Blocks
export type { StepAction } from './definitions/blocks.js';

// Definitions - Brain types
export type { GeneratedPage, BrainConfig } from './definitions/brain-types.js';

// Definitions - Run params
export type {
  InitialRunParams,
  RerunParams,
} from './definitions/run-params.js';

// Execution - Constants
export { DEFAULT_ENV } from './execution/constants.js';
