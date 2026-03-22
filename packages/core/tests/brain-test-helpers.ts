import { jest } from '@jest/globals';
import { z } from 'zod';
import { ObjectGenerator } from '../src/clients/types.js';
import type { ResourceLoader } from '../src/resources/resource-loader.js';
import { createResources } from '../src/resources/resources.js';
import type { BrainEvent } from '../src/dsl/brain.js';
import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';

// Helper function to get the next value from an AsyncIterator
export const nextStep = async <T>(brainRun: AsyncIterator<T>): Promise<T> => {
  const result = await brainRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};

// Helper: replay events through the brain state machine to get final state.
// Handles nested brain depth tracking and patch scoping automatically.
export function finalStateFromEvents(events: BrainEvent<any>[]): any {
  const sm = createBrainExecutionMachine();
  for (const event of events) {
    sendEvent(sm, event as any);
  }
  return sm.context.currentState;
}

// Helper: run brain, feed events into state machine, return events + final state + machine.
export const runWithStateMachine = async (
  brainInstance: any,
  runParams: any
) => {
  const sm = createBrainExecutionMachine();
  const events: BrainEvent<any>[] = [];
  for await (const event of brainInstance.run(runParams)) {
    events.push(event);
    sendEvent(sm, event as any);
  }
  return { events, finalState: sm.context.currentState as any, sm };
};

// Define a Logger interface for testing
interface Logger {
  log: (message: string) => void;
}

// Mock services for testing
export const testLogger: Logger = {
  log: jest.fn(),
};

export type AssertEquals<T, U> = 0 extends 1 & T
  ? false // fails if T is any
  : 0 extends 1 & U
  ? false // fails if U is any
  : [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

// Mock ObjectGenerator for testing
export const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
export const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
export const mockGenerateText =
  jest.fn<NonNullable<ObjectGenerator['generateText']>>();
export const mockCreateToolResultMessage =
  jest.fn<NonNullable<ObjectGenerator['createToolResultMessage']>>();
export const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
  generateText: mockGenerateText,
  createToolResultMessage: mockCreateToolResultMessage,
};

export const dummyOutputSchema = z.object({ result: z.string() });
export const dummyStateKey = 'agentResult' as const;

// Mock Resources for testing
export const mockResourceLoad = jest.fn(
  async (
    resourceName: string,
    type?: 'text' | 'binary'
  ): Promise<string | Buffer> => {
    if (type === 'binary')
      return Buffer.from(`mock ${resourceName} binary content`);
    return `mock ${resourceName} text content`;
  }
) as jest.MockedFunction<ResourceLoader['load']>;

export const mockResourceLoader: ResourceLoader = {
  load: mockResourceLoad,
};

export const testManifest = {
  myFile: {
    type: 'text' as const,
    key: 'myFile',
    path: '/test/myFile.txt',
  },
  myBinaryFile: {
    type: 'binary' as const,
    key: 'myBinaryFile',
    path: '/test/myBinaryFile.bin',
  },
  nested: {
    anotherFile: {
      type: 'text' as const,
      key: 'anotherFile',
      path: '/test/anotherFile.txt',
    },
  },
} as const;
export const mockResources = createResources(mockResourceLoader, testManifest);
