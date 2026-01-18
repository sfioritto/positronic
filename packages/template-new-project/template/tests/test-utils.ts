import type { ObjectGenerator } from '@positronic/core';
import type { BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS, applyPatches } from '@positronic/core';
import { jest } from '@jest/globals';

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

  const streamText = jest.fn(async () => {
    throw new Error('streamText not implemented in mock');
  });

  return {
    generateObject,
    streamText,
    mockResponses: (...newResponses: any[]) => {
      responses.push(...newResponses);
    },
    clearMocks: () => {
      responses.length = 0;
      responseIndex = 0;
      generateObject.mockClear();
      streamText.mockClear();
    },
  };
}

export interface BrainTestResult<TState> {
  completed: boolean;
  error: Error | null;
  finalState: TState;
  events: BrainEvent<any>[];
}

export async function runBrainTest<
  TOptions extends object = object,
  TState extends object = object,
  TServices extends object = object
>(
  brain: any,
  params?: {
    client?: ObjectGenerator;
    initialState?: Partial<TState>;
    resources?: any;
    options?: TOptions;
    services?: TServices;
  }
): Promise<BrainTestResult<TState>> {
  const events: BrainEvent<any>[] = [];
  let finalState: any = params?.initialState || {};
  let error: Error | null = null;
  let completed = false;

  try {
    const runOptions = {
      client: params?.client,
      initialState: params?.initialState,
      resources: params?.resources,
      options: params?.options,
    };

    // If brain has services, we need to apply them first
    const brainToRun = params?.services ? brain.withServices(params.services) : brain;

    for await (const event of brainToRun.run(runOptions)) {
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