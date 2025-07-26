import type { ObjectGenerator } from './clients/types.js';
import type { BrainEvent } from './dsl/brain.js';
import { BRAIN_EVENTS } from './dsl/constants.js';
import { applyPatches } from './dsl/json-patch.js';

export interface MockClient extends ObjectGenerator {
  mockResponses: (...responses: any[]) => void;
  clearMocks: () => void;
}

export function createMockClient(): MockClient {
  const responses: any[] = [];
  let responseIndex = 0;

  const generateObject = jest.fn(async () => {
    if (responseIndex >= responses.length) {
      throw new Error('No more mock responses available');
    }
    return responses[responseIndex++];
  });

  return {
    generateObject,
    mockResponses: (...newResponses: any[]) => {
      responses.push(...newResponses);
    },
    clearMocks: () => {
      responses.length = 0;
      responseIndex = 0;
      generateObject.mockClear();
    },
  };
}

export interface BrainTestResult<TState> {
  completed: boolean;
  error: Error | null;
  finalState: TState;
  events: BrainEvent<any>[];
}

export async function runBrainTest<TOptions extends object, TState extends object>(
  brain: any,
  options?: {
    client?: ObjectGenerator;
    initialState?: Partial<TState>;
    resources?: any;
  }
): Promise<BrainTestResult<TState>> {
  const events: BrainEvent<any>[] = [];
  let finalState: any = options?.initialState || {};
  let error: Error | null = null;
  let completed = false;

  try {
    const runOptions = {
      ...options,
      state: options?.initialState,
    };

    for await (const event of brain.run(runOptions)) {
      events.push(event);

      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      } else if (event.type === BRAIN_EVENTS.ERROR) {
        error = new Error(event.error.message);
      } else if (event.type === BRAIN_EVENTS.COMPLETE) {
        completed = true;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  return {
    completed,
    error,
    finalState,
    events,
  };
}