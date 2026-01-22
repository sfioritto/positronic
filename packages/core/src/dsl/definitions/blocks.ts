import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, AgentTool, AgentConfig } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type { GeneratedPage } from './brain-types.js';

// Shared interface for step action functions
export type StepAction<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWaitFor extends readonly any[] = readonly [],
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
  | { state: TStateOut; waitFor: TWaitFor }
  | Promise<{ state: TStateOut; waitFor: TWaitFor }>
  | { state: TStateOut; promptResponse: TResponseOut }
  | Promise<{ state: TStateOut; promptResponse: TResponseOut }>;

export type StepBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly [],
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
    TWebhooks,
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
  TTools extends Record<string, AgentTool> = Record<string, AgentTool>
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
  ) => AgentConfig<TTools> | Promise<AgentConfig<TTools>>;
};

export type Block<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly [],
  TPageIn extends GeneratedPage | undefined = undefined
> =
  | StepBlock<
      TStateIn,
      TStateOut,
      TOptions,
      TServices,
      TResponseIn,
      TWebhooks,
      TPageIn
    >
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>
  | AgentBlock<TStateIn, TStateOut, TOptions, TServices, TResponseIn>;
