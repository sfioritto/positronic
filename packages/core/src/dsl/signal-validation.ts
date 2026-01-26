import { BRAIN_EVENTS, STATUS } from './constants.js';

/**
 * Map signal types to the events they would emit.
 * These events must have valid transitions from the current state.
 */
const signalToEvent: Record<string, string> = {
  'KILL': BRAIN_EVENTS.CANCELLED,
  'PAUSE': BRAIN_EVENTS.PAUSED,
  'RESUME': BRAIN_EVENTS.RESUMED,
  'USER_MESSAGE': BRAIN_EVENTS.AGENT_USER_MESSAGE,
  'WEBHOOK_RESPONSE': BRAIN_EVENTS.WEBHOOK_RESPONSE,
};

/**
 * Map brain status (from MonitorDO) to state machine state names.
 * The state machine uses different internal names than the public status values.
 */
const statusToState: Record<string, string> = {
  [STATUS.PENDING]: 'idle',
  [STATUS.RUNNING]: 'running',
  [STATUS.PAUSED]: 'paused',
  [STATUS.WAITING]: 'waiting',
  [STATUS.COMPLETE]: 'complete',
  [STATUS.ERROR]: 'error',
  [STATUS.CANCELLED]: 'cancelled',
  // Note: AGENT_LOOP status maps to 'agentLoop' state, but publicly shows as 'running'
  // Since the public status is always 'running' for agent loops, this mapping is for running
};

/**
 * Machine state definition structure.
 * This matches the structure returned by robot3 createMachine.
 */
export interface MachineStateDefinition {
  states: Record<string, { transitions: Map<string, unknown> }>;
}

/**
 * Result of signal validation.
 */
export interface SignalValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Check if a signal is valid for the current brain state.
 * Uses the state machine definition as the source of truth.
 *
 * @param machineDefinition - The state machine definition with states and transitions
 * @param brainStatus - The current brain status (e.g., 'running', 'paused', 'complete')
 * @param signalType - The signal type to validate (e.g., 'PAUSE', 'KILL', 'RESUME')
 * @returns Validation result with valid flag and optional reason for rejection
 */
export function isSignalValid(
  machineDefinition: MachineStateDefinition,
  brainStatus: string,
  signalType: string
): SignalValidationResult {
  const eventName = signalToEvent[signalType];
  if (!eventName) {
    return { valid: false, reason: `Unknown signal type: ${signalType}` };
  }

  const stateName = statusToState[brainStatus];
  if (!stateName) {
    return { valid: false, reason: `Unknown brain status: ${brainStatus}` };
  }

  const stateObj = machineDefinition.states[stateName];
  if (!stateObj) {
    return { valid: false, reason: `State '${stateName}' not found in machine` };
  }

  const hasTransition = stateObj.transitions.has(eventName);
  if (!hasTransition) {
    return {
      valid: false,
      reason: `Cannot ${signalType} brain in '${brainStatus}' state`,
    };
  }

  return { valid: true };
}

/**
 * Get the list of valid signals for a given brain status.
 * Useful for debugging and for providing user feedback.
 *
 * @param machineDefinition - The state machine definition with states and transitions
 * @param brainStatus - The current brain status
 * @returns Array of valid signal types
 */
export function getValidSignals(
  machineDefinition: MachineStateDefinition,
  brainStatus: string
): string[] {
  const stateName = statusToState[brainStatus];
  if (!stateName) {
    return [];
  }

  const stateObj = machineDefinition.states[stateName];
  if (!stateObj) {
    return [];
  }

  const validSignals: string[] = [];
  for (const [signalType, eventName] of Object.entries(signalToEvent)) {
    if (stateObj.transitions.has(eventName)) {
      validSignals.push(signalType);
    }
  }

  return validSignals;
}
