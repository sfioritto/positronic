export { Brain, brain } from './dsl/brain.js';
export { BrainRunner } from './dsl/brain-runner.js';
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
export type { ObjectGenerator, Message, ToolMessage } from './clients/types.js';
export type {
  State,
  RuntimeEnv,
  Secrets,
  LoopTool,
  LoopConfig,
  LoopMessage,
  LoopToolWaitFor,
  ExtractTerminalInput,
  RetryConfig,
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

// Loop step event exports
export type {
  LoopStartEvent,
  LoopIterationEvent,
  LoopToolCallEvent,
  LoopToolResultEvent,
  LoopAssistantMessageEvent,
  LoopCompleteEvent,
  LoopTokenLimitEvent,
  LoopWebhookEvent,
  WebhookResponseEvent,
  HeartbeatEvent,
} from './dsl/brain.js';

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
} from './dsl/brain-state-machine.js';
