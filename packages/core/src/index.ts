export { Brain, brain, Continuation } from './dsl/brain.js';
export { BrainRunner } from './dsl/brain-runner.js';
export { createBrain } from './dsl/create-brain.js';
export type { CreateBrainConfig } from './dsl/create-brain.js';
export { STATUS, BRAIN_EVENTS } from './dsl/constants.js';
export type { Adapter } from './adapters/types.js';
export type {
  BrainEvent,
  SerializedStep,
  ResumeParams,
  InitialRunParams,
  ResumeRunParams,
  BrainStartEvent,
  BrainCompleteEvent,
  BrainErrorEvent,
  StepStatusEvent,
  StepStartedEvent,
  StepCompletedEvent,
  BrainStructure,
  BrainConfig,
  GeneratedPage,
} from './dsl/brain.js';
export type {
  ObjectGenerator,
  Message,
  ToolMessage,
  ToolCall,
  ResponseMessage,
  ToolChoice,
} from './clients/types.js';
export type {
  State,
  CurrentUser,
  RuntimeEnv,
  Secrets,
  AgentTool,
  AgentConfig,
  AgentConfigWithOutput,
  AgentMessage,
  AgentToolWaitFor,
  StepContext,
  ExtractTerminalInput,
  SignalType,
  BrainSignal,
  SignalProvider,
} from './dsl/types.js';
export type {
  TemplateContext,
  TemplateReturn,
} from './dsl/definitions/blocks.js';
export type { TemplateNode, TemplateChild } from './jsx-runtime.js';
export { Fragment } from './jsx-runtime.js';
export {
  renderTemplate,
  isTemplateNode,
  resolveTemplate,
} from './template/render.js';
export { applyPatches } from './dsl/json-patch.js';
export { IterateResult } from './dsl/iterate-result.js';
export { parseDuration } from './dsl/duration.js';

// Only needed for development to ensure that zod version numbers are the same, it's a peer
// dependency so when not using file://..path/to/package links the version numbers
// will match just fine if the user has the same version of zod installed.
// NOTE: Not 100% sure this is still needed - worth re-evaluating if we can remove this.
export { z } from 'zod';

export type { ResourceLoader } from './resources/resource-loader.js';
export { createResources, type Resources } from './resources/resources.js';
export { createWebhook } from './dsl/webhook.js';
export type {
  WebhookFunction,
  WebhookRegistration,
  WebhookTriggerConfig,
} from './dsl/webhook.js';
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
  IterateItemCompleteEvent,
} from './dsl/definitions/events.js';

// Default tools
export {
  createTool,
  defaultTools,
  generateUI,
  waitForWebhook,
  print,
  consoleLog,
} from './tools/index.js';

// Store types
export type {
  Store,
  StoreProvider,
  PerUserField,
  InferStoreTypes,
} from './store/types.js';

// Memory types and utilities
export type {
  Memory,
  MemoryMessage,
  MemoryScope,
  MemorySearchOptions,
  MemoryAddOptions,
  MemoryProvider,
  ScopedMemory,
} from './memory/types.js';
export { createScopedMemory } from './memory/scoped-memory.js';

// UI types (only UIComponent is public - used by gen-ui-components)
export type { UIComponent } from './ui/types.js';

// UI utilities
export { generateFormToken } from './ui/generate-page-html.js';
export { parseFormData } from './ui/parse-form-data.js';

// Webhook token validation
export { validateWebhookToken } from './validate-webhook-token.js';

// Brain state machine
export {
  createBrainExecutionMachine,
  createBrainMachine,
  sendEvent,
  reconstructBrainTree,
  brainMachineDefinition,
} from './dsl/brain-state-machine.js';

// Signal validation
export { isSignalValid, getValidSignals } from './dsl/signal-validation.js';
export type {
  MachineStateDefinition,
  SignalValidationResult,
} from './dsl/signal-validation.js';
export type {
  BrainStateMachine,
  BrainExecutionContext,
  BrainStackEntry,
  BrainEntry,
  ExecutionStackEntry,
  RunningBrain,
  StepInfo,
  ExecutionState,
  CreateMachineOptions,
  AgentContext,
  IterateContext,
  ExecutionNode,
} from './dsl/brain-state-machine.js';
