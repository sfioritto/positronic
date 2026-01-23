import { describe, it, expect } from '@jest/globals';
import { BRAIN_EVENTS } from '@positronic/core';
import { getAgentLoops, getAgentLabel } from '../src/utils/agent-utils.js';
import type { StoredEvent } from '../src/utils/state-reconstruction.js';

// Helper to create a StoredEvent
function createStoredEvent(event: any, timestampOffset = 0): StoredEvent {
  return {
    timestamp: new Date(Date.now() + timestampOffset),
    event,
  };
}

describe('getAgentLabel', () => {
  it('should return stepTitle for regular steps', () => {
    expect(getAgentLabel('process-data')).toBe('process-data');
    expect(getAgentLabel('analyze')).toBe('analyze');
  });

  it('should return stepTitle when brainTitle is undefined', () => {
    expect(getAgentLabel('main')).toBe('main');
    expect(getAgentLabel('main', undefined)).toBe('main');
  });

  it('should return brainTitle for main steps when brainTitle is provided', () => {
    expect(getAgentLabel('main', 'MyBrain')).toBe('MyBrain');
  });

  it('should return stepTitle for non-main steps even when brainTitle is provided', () => {
    expect(getAgentLabel('process-data', 'MyBrain')).toBe('process-data');
  });
});

describe('getAgentLoops', () => {
  it('should return empty array for empty events', () => {
    const result = getAgentLoops([]);
    expect(result).toEqual([]);
  });

  it('should return empty array when no agent events exist', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: {},
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_START,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
      }, 100),
    ];

    const result = getAgentLoops(events);
    expect(result).toEqual([]);
  });

  it('should extract single agent loop with start event', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'process-data',
        stepId: 'agent-1',
        prompt: 'Process this data',
        system: 'You are a data processor',
        tools: ['tool1', 'tool2'],
        options: {},
      }),
    ];

    const result = getAgentLoops(events);
    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('agent-1');
    expect(result[0].stepTitle).toBe('process-data');
    expect(result[0].label).toBe('process-data');
    expect(result[0].startEvent.prompt).toBe('Process this data');
    expect(result[0].rawResponseEvents).toEqual([]);
  });

  it('should collect raw response events for agent', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'process-data',
        stepId: 'agent-1',
        prompt: 'Process this data',
        options: {},
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
        brainRunId: 'run-1',
        stepTitle: 'process-data',
        stepId: 'agent-1',
        iteration: 1,
        message: { role: 'assistant', content: 'Hello' },
        options: {},
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
        brainRunId: 'run-1',
        stepTitle: 'process-data',
        stepId: 'agent-1',
        iteration: 2,
        message: { role: 'assistant', content: 'World' },
        options: {},
      }, 200),
    ];

    const result = getAgentLoops(events);
    expect(result).toHaveLength(1);
    expect(result[0].rawResponseEvents).toHaveLength(2);
    expect(result[0].rawResponseEvents[0].iteration).toBe(1);
    expect(result[0].rawResponseEvents[1].iteration).toBe(2);
  });

  it('should group events by stepId for multiple agents', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'agent-one',
        stepId: 'agent-1',
        prompt: 'First agent',
        options: {},
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
        brainRunId: 'run-1',
        stepTitle: 'agent-one',
        stepId: 'agent-1',
        iteration: 1,
        message: { role: 'assistant', content: 'Agent 1 response' },
        options: {},
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'agent-two',
        stepId: 'agent-2',
        prompt: 'Second agent',
        options: {},
      }, 200),
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
        brainRunId: 'run-1',
        stepTitle: 'agent-two',
        stepId: 'agent-2',
        iteration: 1,
        message: { role: 'assistant', content: 'Agent 2 response' },
        options: {},
      }, 300),
    ];

    const result = getAgentLoops(events);
    expect(result).toHaveLength(2);

    expect(result[0].stepId).toBe('agent-1');
    expect(result[0].stepTitle).toBe('agent-one');
    expect(result[0].rawResponseEvents).toHaveLength(1);

    expect(result[1].stepId).toBe('agent-2');
    expect(result[1].stepTitle).toBe('agent-two');
    expect(result[1].rawResponseEvents).toHaveLength(1);
  });

  it('should use brainTitle for main step label', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'main',
        stepId: 'main-agent',
        prompt: 'Brain-level agent',
        options: {},
      }),
    ];

    const result = getAgentLoops(events, 'MyAwesomeBrain');
    expect(result).toHaveLength(1);
    expect(result[0].stepTitle).toBe('main');
    expect(result[0].label).toBe('MyAwesomeBrain');
  });

  it('should ignore raw response events without matching start event', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
        brainRunId: 'run-1',
        stepTitle: 'orphan-agent',
        stepId: 'orphan-1',
        iteration: 1,
        message: { role: 'assistant', content: 'Orphan response' },
        options: {},
      }),
    ];

    const result = getAgentLoops(events);
    expect(result).toEqual([]);
  });

  it('should handle agent with system prompt', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId: 'run-1',
        stepTitle: 'helper',
        stepId: 'agent-1',
        prompt: 'Help me with this',
        system: 'You are a helpful assistant.',
        tools: ['search', 'calculate'],
        options: {},
      }),
    ];

    const result = getAgentLoops(events);
    expect(result).toHaveLength(1);
    expect(result[0].startEvent.system).toBe('You are a helpful assistant.');
    expect(result[0].startEvent.tools).toEqual(['search', 'calculate']);
  });

});
