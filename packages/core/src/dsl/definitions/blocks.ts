import { z } from 'zod';
import type { ObjectGenerator, ToolChoice } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, Tool } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type { GeneratedPage } from './brain-types.js';
import type { WebhookRegistration } from '../webhook.js';
import type { TemplateChild } from '../../jsx-runtime.js';
import type { FileHandle } from '../../files/types.js';

export type TemplateReturn = TemplateChild | Promise<TemplateChild>;

// Shared interface for step action functions
export type StepAction<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TResponseOut extends JsonObject | undefined = undefined,
  TPageIn extends GeneratedPage | undefined = undefined
> = (
  params: {
    state: TStateIn;
    options: TOptions;
    client: ObjectGenerator;
    resources: Resources;
    response: TResponseIn;
    page: TPageIn;
    pages?: PagesService;
    env: RuntimeEnv;
  } & TServices
) =>
  | TStateOut
  | Promise<TStateOut>
  | { state: TStateOut; promptResponse: TResponseOut }
  | Promise<{ state: TStateOut; promptResponse: TResponseOut }>;

export type StepBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TPageIn extends GeneratedPage | undefined = undefined
> = {
  type: 'step';
  title: string;
  action: StepAction<
    TStateIn,
    TStateOut,
    TOptions,
    TServices,
    TResponseIn,
    JsonObject | undefined,
    TPageIn
  >;
  /** If true, this is a page generation step that requires components configuration */
  isPageStep?: boolean;
  /** Config function for page generation steps — called with step context, returns page config */
  pageConfigFn?: (context: any) => PageConfig | Promise<PageConfig>;
  /** Per-step client override for prompt steps */
  client?: ObjectGenerator;
};

export type WaitBlock<
  TState,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TPage extends GeneratedPage | undefined = undefined
> = {
  type: 'wait';
  title: string;
  timeout?: number;
  action: (
    params: {
      state: TState;
      options: TOptions;
      client: ObjectGenerator;
      resources: Resources;
      page: TPage;
      pages?: PagesService;
      env: RuntimeEnv;
    } & TServices
  ) =>
    | WebhookRegistration<any>
    | readonly WebhookRegistration<any>[]
    | Promise<WebhookRegistration<any>>
    | Promise<readonly WebhookRegistration<any>[]>;
};

// BrainBlock uses a generic TInnerBrain to avoid circular dependency with Brain class
export type BrainBlock<
  TOuterState,
  TInnerState extends State,
  TNewState,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TInnerBrain = any
> = {
  type: 'brain';
  title: string;
  innerBrain: TInnerBrain;
  initialState?: State | ((context: any) => State);
  options?: JsonObject | ((context: any) => JsonObject);
};

export type GuardBlock<TStateIn, TOptions extends JsonObject = JsonObject> = {
  type: 'guard';
  title: string;
  predicate: (params: any) => boolean;
};

export type PageConfig = {
  prompt: TemplateReturn;
  formSchema?: z.ZodObject<any>;
  onCreated?: (page: GeneratedPage) => void | Promise<void>;
  props?: Record<string, unknown>;
  ttl?: number;
  persist?: boolean;
};

export type PromptLoopConfig = {
  tools: Record<string, Tool<any>>;
  maxIterations?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
};

export type PromptConfig<TSchema extends z.ZodObject<any> = z.ZodObject<any>> =
  {
    message: TemplateReturn;
    system?: TemplateReturn;
    outputSchema: TSchema;
    client?: ObjectGenerator;
    attachments?: FileHandle[];
    loop?: PromptLoopConfig;
  };

export type PromptBlock = {
  type: 'prompt';
  title: string;
  configFn: (context: any) => PromptConfig | Promise<PromptConfig>;
};

export type MapConfig = {
  over: any[];
  error?: (item: any, error: Error) => any | null;
  // Brain mode
  run?: any;
  initialState?: (item: any) => State;
  options?: any;
  // Prompt mode
  prompt?: {
    message: (item: any) => TemplateReturn;
    system?: TemplateReturn | ((item: any) => TemplateReturn);
    outputSchema: z.ZodObject<any>;
    loop?: PromptLoopConfig;
  };
  client?: ObjectGenerator;
};

// MapBlock: runs an inner brain or prompt once per item from the `over` list
export type MapBlock = {
  type: 'map';
  title: string;
  stateKey: string;
  configFn: (context: any) => MapConfig | Promise<MapConfig>;
};

export type Block<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TPageIn extends GeneratedPage | undefined = undefined
> =
  | StepBlock<TStateIn, TStateOut, TOptions, TServices, TResponseIn, TPageIn>
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>
  | GuardBlock<TStateIn, TOptions>
  | WaitBlock<TStateIn, TOptions, TServices, TPageIn>
  | MapBlock
  | PromptBlock;
