import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, SignalProvider } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { PagesService } from '../pages.js';
import type { AgentContext } from '../brain-state-machine.js';

/**
 * ResumeContext tracks the execution state needed to resume a brain.
 * Forms a tree structure for nested brains.
 */
export interface ResumeContext {
  stepIndex: number;              // Step index to resume from (0-based)
  state: JsonObject;              // State for this brain level
  innerResumeContext?: ResumeContext;  // For nested brain
  agentContext?: AgentContext;    // If resuming mid-agent (at deepest level only)
  webhookResponse?: JsonObject;   // External input if from webhook (at deepest level only)
  batchProgress?: {               // If resuming mid-batch (at deepest level only)
    accumulatedResults: ([any, any] | undefined)[];
    processedCount: number;
    totalItems: number;
    schemaName: string;
  };
}

export interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
  pages?: PagesService;
  env?: RuntimeEnv;
  signalProvider?: SignalProvider;
}

export interface InitialRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState?: State;
  resumeContext?: never;
  brainRunId?: string;
}

export interface ResumeRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  resumeContext: ResumeContext;
  brainRunId: string;
}
