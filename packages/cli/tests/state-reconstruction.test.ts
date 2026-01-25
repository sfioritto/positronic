import { describe, it, expect } from '@jest/globals';
import { BRAIN_EVENTS } from '@positronic/core';
import { reconstructStateAtEvent } from '../src/utils/state-reconstruction.js';
import type { StoredEvent } from '../src/utils/state-reconstruction.js';

// Helper to create a StoredEvent
function createStoredEvent(event: any, timestampOffset = 0): StoredEvent {
  return {
    timestamp: new Date(Date.now() + timestampOffset),
    event,
  };
}

describe('reconstructStateAtEvent', () => {
  it('should return empty object for empty events array', () => {
    const result = reconstructStateAtEvent([], 0);
    expect(result).toEqual({});
  });

  it('should return empty object for negative targetIndex', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
    ];
    const result = reconstructStateAtEvent(events, -1);
    expect(result).toEqual({});
  });

  it('should return initialState from brain:start event', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0, name: 'test' },
      }),
    ];
    const result = reconstructStateAtEvent(events, 0);
    expect(result).toEqual({ count: 0, name: 'test' });
  });

  it('should return empty object if initialState is undefined in brain:start', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        // no initialState
      }),
    ];
    const result = reconstructStateAtEvent(events, 0);
    expect(result).toEqual({});
  });

  it('should apply step:complete patches in order', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 1 }],
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 2',
        stepId: 'step-2',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 2 }],
      }, 200),
    ];

    // At index 0 (brain:start), state is initial
    expect(reconstructStateAtEvent(events, 0)).toEqual({ count: 0 });

    // At index 1 (after first step:complete), state has count: 1
    expect(reconstructStateAtEvent(events, 1)).toEqual({ count: 1 });

    // At index 2 (after second step:complete), state has count: 2
    expect(reconstructStateAtEvent(events, 2)).toEqual({ count: 2 });
  });

  it('should handle add operations in patches', () => {
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
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'add', path: '/name', value: 'Alice' }],
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 2',
        stepId: 'step-2',
        options: {},
        status: 'running',
        patch: [{ op: 'add', path: '/age', value: 30 }],
      }, 200),
    ];

    expect(reconstructStateAtEvent(events, 2)).toEqual({ name: 'Alice', age: 30 });
  });

  it('should handle multiple step completions', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 5 }],
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 2',
        stepId: 'step-2',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 15 }],
      }, 200),
    ];

    // After first step
    expect(reconstructStateAtEvent(events, 1)).toEqual({ count: 5 });

    // After second step
    expect(reconstructStateAtEvent(events, 2)).toEqual({ count: 15 });
  });

  it('should skip non-step events when applying patches', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId: 'run-1',
        options: {},
        steps: [{ id: 'step-1', title: 'Step 1', status: 'running' }],
      }, 50),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_START,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
      }, 75),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 1 }],
      }, 100),
    ];

    // At index 3 (step:complete), state should be { count: 1 }
    expect(reconstructStateAtEvent(events, 3)).toEqual({ count: 1 });

    // At index 2 (step:start), state should still be { count: 0 } - patch not applied yet
    expect(reconstructStateAtEvent(events, 2)).toEqual({ count: 0 });
  });

  it('should return empty object if no brain:start found before target', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId: 'run-1',
        options: {},
        steps: [{ id: 'step-1', title: 'Step 1', status: 'running' }],
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 1 }],
      }, 100),
    ];

    // No brain:start event, so return empty object
    expect(reconstructStateAtEvent(events, 1)).toEqual({});
  });

  it('should clamp targetIndex to valid range', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/count', value: 1 }],
      }, 100),
    ];

    // targetIndex beyond array length should clamp to last element
    expect(reconstructStateAtEvent(events, 100)).toEqual({ count: 1 });
  });

  it('should handle empty patches gracefully', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { count: 0 },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [],  // Empty patch
      }, 100),
    ];

    expect(reconstructStateAtEvent(events, 1)).toEqual({ count: 0 });
  });

  it('should handle complex nested state changes', () => {
    const events: StoredEvent[] = [
      createStoredEvent({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
        brainRunId: 'run-1',
        options: {},
        status: 'running',
        initialState: { user: { name: 'Alice', settings: { theme: 'light' } } },
      }),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 1',
        stepId: 'step-1',
        options: {},
        status: 'running',
        patch: [{ op: 'replace', path: '/user/settings/theme', value: 'dark' }],
      }, 100),
      createStoredEvent({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId: 'run-1',
        stepTitle: 'Step 2',
        stepId: 'step-2',
        options: {},
        status: 'running',
        patch: [{ op: 'add', path: '/user/settings/notifications', value: true }],
      }, 200),
    ];

    expect(reconstructStateAtEvent(events, 2)).toEqual({
      user: {
        name: 'Alice',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
    });
  });
});
