import type { JsonObject } from './types.js';
import type { AgentContext } from './brain-state-machine.js';

/**
 * Context for resuming an agent execution.
 * Extends the state machine's AgentContext with an optional webhook response.
 * The webhook response is only present when resuming from a webhook (vs a pause).
 */
export interface AgentResumeContext extends AgentContext {
  /** The raw webhook response - only present for webhook resume, not pause resume */
  webhookResponse?: JsonObject;
}
