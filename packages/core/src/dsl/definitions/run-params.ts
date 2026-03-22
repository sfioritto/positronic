import type { ObjectGenerator } from '../../clients/types.js';
import type {
  State,
  JsonObject,
  RuntimeEnv,
  SignalProvider,
  CurrentUser,
} from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type {
  ExecutionStackEntry,
  IterateContext,
} from '../brain-state-machine.js';
import type { SerializedPageContext } from '../webhook.js';
import type { StoreProvider } from '../../store/types.js';
import type { FilesService } from '../../files/types.js';

export interface ResumeParams {
  state: JsonObject;
  stepIndex: number;
  innerStack?: ExecutionStackEntry[];
  iterateProgress?: Omit<IterateContext, 'stepId'>;
  currentPage?: SerializedPageContext;
  webhookResponse?: JsonObject;
}

export interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
  pages?: PagesService;
  env?: RuntimeEnv;
  signalProvider?: SignalProvider;
  governor?: (client: ObjectGenerator) => ObjectGenerator;
  storeProvider?: StoreProvider;
  files?: FilesService;
  currentUser: CurrentUser;
  services?: Record<string, any>;
}

export interface InitialRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState?: State;
  resume?: never;
  brainRunId?: string;
}

export interface ResumeRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  resume: ResumeParams;
  brainRunId: string;
}
