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
  StreamTool,
  Message,
  ToolMessage,
  ToolCall,
  ResponseMessage,
  ToolChoice,
  Attachment,
} from './clients/types.js';
export type {
  State,
  CurrentUser,
  RuntimeEnv,
  Secrets,
  Tool,
  ToolWaitFor,
  StepContext,
  SignalType,
  BrainSignal,
  SignalProvider,
} from './dsl/types.js';
export type { TemplateReturn } from './dsl/definitions/blocks.js';
export type { TemplateNode, TemplateChild } from './jsx-runtime.js';
export { Fragment, File, Resource, Form } from './jsx-runtime.js';
export {
  renderTemplate,
  isTemplateNode,
  resolveTemplate,
  buildTemplateContext,
} from './template/render.js';
export type { TemplateContext } from './template/render.js';
export { renderHtml } from './template/render-html.js';
export type { RenderHtmlContext } from './template/render-html.js';
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
export type { Pages, Page, PageCreateOptions } from './dsl/pages.js';
export type {
  Manifest as ResourceManifest,
  Entry as ResourceEntry,
  ResourceType,
} from './resources/resources.js';
export { RESOURCE_TYPES } from './resources/resources.js';

export type {
  WebhookResponseEvent,
  BrainPausedEvent,
  IterateItemCompleteEvent,
  FileWriteStartEvent,
  FileWriteCompleteEvent,
  PromptStartEvent,
  PromptIterationEvent,
  PromptToolCallEvent,
  PromptToolResultEvent,
  PromptAssistantMessageEvent,
  PromptCompleteEvent,
  PromptTokenLimitEvent,
  PromptIterationLimitEvent,
  PromptRawResponseMessageEvent,
  PromptWebhookEvent,
} from './dsl/definitions/events.js';

// Default tools
export {
  createTool,
  defaultTools,
  waitForWebhook,
  print,
  consoleLog,
  readFile,
  writeFile,
} from './tools/index.js';

// Store types
export type {
  Store,
  StoreProvider,
  PerUserField,
  InferStoreTypes,
} from './store/types.js';

// Files
export { guessMimeType } from './files/mime.js';
export type {
  FileInput,
  FileOptions,
  FileRef,
  FileHandle,
  Files,
  ZipBuilder,
} from './files/types.js';

// Memory types (used by mem0 plugin package)
export type {
  Memory,
  MemoryEntry,
  MemoryMessage,
  MemoryScope,
  MemorySearchOptions,
  MemoryAddOptions,
  MemoryProvider,
} from './memory/types.js';

// Plugin system
export { definePlugin } from './plugins/index.js';
export { collectPluginWebhooks } from './plugins/collect-webhooks.js';
export type {
  CreateContext,
  PluginAdapter,
  PluginCreateReturn,
  PluginDefinition,
  PluginInjection,
  PluginsFrom,
  PluginsFromArray,
  ConfiguredPlugin,
  ConfiguredPluginWithSetup,
} from './plugins/index.js';

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
  IterateContext,
  PromptLoopContext,
  ExecutionNode,
} from './dsl/brain-state-machine.js';
