import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, AgentTool, AgentConfig, AgentOutputSchema } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type { GeneratedPage } from './brain-types.js';
import type { WebhookRegistration } from '../webhook.js';

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
  /** If true, this is a UI generation step that requires components configuration */
  isUIStep?: boolean;
  /** Configuration for UI generation steps */
  uiConfig?: {
    template: (state: TStateIn, resources: Resources) => string | Promise<string>;
    responseSchema?: z.ZodObject<any>;
  };
  /** Configuration for batch prompt execution (prompt with `over`) */
  batchConfig?: {
    over: (state: any) => any[];
    maxRetries?: number;
    error?: (item: any, error: Error) => any | null;
    template: (item: any, resources: Resources) => string | Promise<string>;
    schema: z.ZodObject<any>;
    schemaName: string;
    client?: ObjectGenerator;
    chunkSize?: number;
  };
};

export type WaitBlock<
  TState,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TPage extends GeneratedPage | undefined = undefined
> = {
  type: 'wait';
  title: string;
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
  initialState: State | ((outerState: TOuterState) => State);
  action: (
    outerState: TOuterState,
    innerState: TInnerState,
    services: TServices
  ) => TNewState;
};

export type AgentBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TTools extends Record<string, AgentTool> = Record<string, AgentTool>,
  TOutputSchema extends AgentOutputSchema | undefined = undefined
> = {
  type: 'agent';
  title: string;
  configFn: (
    params: {
      state: TStateIn;
      options: TOptions;
      client: ObjectGenerator;
      resources: Resources;
      response: TResponseIn;
      pages?: PagesService;
      env: RuntimeEnv;
    } & TServices
  ) => AgentConfig<TTools, TOutputSchema> | Promise<AgentConfig<TTools, TOutputSchema>>;
};

export type GuardBlock<
  TStateIn,
  TOptions extends JsonObject = JsonObject,
> = {
  type: 'guard';
  title: string;
  predicate: (params: { state: TStateIn; options: TOptions }) => boolean;
};

export type Block<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TPageIn extends GeneratedPage | undefined = undefined
> =
  | StepBlock<
      TStateIn,
      TStateOut,
      TOptions,
      TServices,
      TResponseIn,
      TPageIn
    >
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>
  | AgentBlock<TStateIn, TStateOut, TOptions, TServices, TResponseIn>
  | GuardBlock<TStateIn, TOptions>
  | WaitBlock<TStateIn, TOptions, TServices, TPageIn>;
