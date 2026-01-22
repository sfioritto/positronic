import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type { SerializedStep } from './steps.js';
import type { AgentResumeContext } from '../agent-messages.js';

export interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
  pages?: PagesService;
  env?: RuntimeEnv;
}

export interface InitialRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState?: State;
  initialCompletedSteps?: never;
  brainRunId?: string;
}

export interface RerunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState: State;
  initialCompletedSteps: SerializedStep[];
  brainRunId: string;
  response?: JsonObject;
  agentResumeContext?: AgentResumeContext | null;
}
