import type { ObjectGenerator } from '../../clients/types.js';
import type {
  State,
  JsonObject,
  RuntimeEnv,
  SignalProvider,
  CurrentUser,
} from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type {
  ExecutionStackEntry,
  IterateContext,
  PromptLoopContext,
} from '../brain-state-machine.js';
import type { SerializedPageContext } from '../webhook.js';
import type { FilesService } from '../../files/types.js';
import type { PagesService } from '../pages.js';
import type { StoreProvider } from '../../store/types.js';
import type { ConfiguredPlugin } from '../../plugins/types.js';

export interface ResumeParams {
  state: JsonObject;
  stepIndex: number;
  innerStack?: ExecutionStackEntry[];
  iterateProgress?: Omit<IterateContext, 'stepId'>;
  currentPage?: SerializedPageContext;
  webhookResponse?: JsonObject;
  promptLoopContext?: PromptLoopContext;
}

export interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  currentUser: CurrentUser;
  resources?: Resources;
  options?: TOptions;
  env?: RuntimeEnv;
  signalProvider?: SignalProvider;
  governor?: (client: ObjectGenerator) => ObjectGenerator;
  /** Platform service: file storage */
  files?: FilesService;
  /** Platform service: page generation */
  pages?: PagesService;
  /** Platform service: typed key-value store factory */
  storeProvider?: StoreProvider;
  /** Plugin configs to resolve per brain run */
  pluginConfigs?: ConfiguredPlugin[];
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
