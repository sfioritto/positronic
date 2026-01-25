export { Brain, brain } from './dsl/brain.js';
export { BrainRunner } from './dsl/brain-runner.js';
export { createBrain } from './dsl/create-brain.js';
export type { CreateBrainConfig } from './dsl/create-brain.js';
export { STATUS, BRAIN_EVENTS } from './dsl/constants.js';
export type { Adapter } from './adapters/types.js';
export type {
  BrainEvent,
  SerializedStep,
  InitialRunParams,
  RerunParams,
  BrainStartEvent,
  BrainCompleteEvent,
  BrainErrorEvent,
  StepStatusEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepRetryEvent,
  BrainStructure,
  BrainConfig,
  GeneratedPage,
} from './dsl/brain.js';
export type { ObjectGenerator, Message, ToolMessage, ToolCall, ResponseMessage } from './clients/types.js';
export type {
  State,
  RuntimeEnv,
  Secrets,
  AgentTool,
  AgentConfig,
  AgentOutputSchema,
  AgentMessage,
  AgentToolWaitFor,
  StepContext,
  ExtractTerminalInput,
  RetryConfig,
  SignalType,
  BrainSignal,
  SignalProvider,
} from './dsl/types.js';
export { applyPatches } from './dsl/json-patch.js';

// Only needed for development to ensure that zod version numbers are the same, it's a peer
// dependency so when not using file://..path/to/package links the version numbers
// will match just fine if the user has the same version of zod installed.
// NOTE: Not 100% sure this is still needed - worth re-evaluating if we can remove this.
export { z } from 'zod';

export type { ResourceLoader } from './resources/resource-loader.js';
export { createResources, type Resources } from './resources/resources.js';
export { createWebhook } from './dsl/webhook.js';
export type { WebhookFunction, WebhookRegistration } from './dsl/webhook.js';
export type { PagesService, Page, PageCreateOptions } from './dsl/pages.js';
export type {
  Manifest as ResourceManifest,
  Entry as ResourceEntry,
  ResourceType,
} from './resources/resources.js';
export { RESOURCE_TYPES } from './resources/resources.js';

// Agent step event exports
export type {
  AgentStartEvent,
  AgentIterationEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentAssistantMessageEvent,
  AgentCompleteEvent,
  AgentTokenLimitEvent,
  AgentIterationLimitEvent,
  AgentWebhookEvent,
  AgentRawResponseMessageEvent,
  AgentUserMessageEvent,
  WebhookResponseEvent,
  BrainPausedEvent,
} from './dsl/definitions/events.js';

// Default tools
export { createTool, defaultTools, defaultDoneSchema, generateUI, waitForWebhook, print, consoleLog } from './tools/index.js';

// UI types (only UIComponent is public - used by gen-ui-components)
export type { UIComponent } from './ui/types.js';

// Brain state machine
export {
  createBrainExecutionMachine,
  createBrainMachine,
  sendEvent,
  getDepth,
  isTopLevel,
  getCurrentStep,
  getBrainStack,
  getBrainRunId,
  getExecutionState,
  getPendingWebhooks,
  getError,
  getAgentContext,
  getCompletedSteps,
} from './dsl/brain-state-machine.js';
export type {
  BrainStateMachine,
  BrainExecutionContext,
  BrainStackEntry,
  RunningBrain,
  StepInfo,
  ExecutionState,
  CreateMachineOptions,
  AgentContext,
} from './dsl/brain-state-machine.js';
export type { AgentResumeContext } from './dsl/agent-messages.js';
