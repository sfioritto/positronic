import type { ObjectGenerator, Message } from '../src/clients/types.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { Adapter } from '../src/adapters/types.js';
import type { BrainEvent, Brain } from '../src/dsl/brain.js';
import type { State } from '../src/dsl/types.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { BrainRunner } from '../src/dsl/brain-runner.js';
import type { Resources } from '../src/resources/resources.js';

/**
 * Mock implementation of ObjectGenerator for testing
 */
export class MockObjectGenerator implements ObjectGenerator {
  private generateObjectMock: jest.Mock<any>;
  private calls: Array<{
    params: Parameters<ObjectGenerator['generateObject']>[0];
    timestamp: Date;
  }> = [];

  constructor() {
    this.generateObjectMock = jest.fn();
  }

  async generateObject<T extends z.AnyZodObject>(
    params: Parameters<ObjectGenerator['generateObject']>[0]
  ): Promise<z.infer<T>> {
    this.calls.push({ params, timestamp: new Date() });
    return this.generateObjectMock(params) as Promise<z.infer<T>>;
  }

  async streamText(): Promise<{
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }>;
    text?: string;
    usage: { totalTokens: number };
  }> {
    throw new Error('streamText not implemented in mock');
  }

  /**
   * Mock a response for the next generateObject call
   */
  mockNextResponse<T>(response: T): void {
    this.generateObjectMock.mockResolvedValueOnce(response as any);
  }

  /**
   * Mock multiple responses in sequence
   */
  mockResponses(...responses: any[]): void {
    responses.forEach((response) => {
      this.generateObjectMock.mockResolvedValueOnce(response as any);
    });
  }

  /**
   * Mock an error for the next generateObject call
   */
  mockNextError(error: Error | string): void {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    this.generateObjectMock.mockRejectedValueOnce(errorObj as any);
  }

  /**
   * Get the underlying jest.Mock for advanced mocking scenarios
   */
  get mock(): jest.Mock<any> {
    return this.generateObjectMock;
  }

  /**
   * Clear all mocks and call history
   */
  clear(): void {
    this.generateObjectMock.mockClear();
    this.calls = [];
  }

  /**
   * Reset mock to initial state
   */
  reset(): void {
    this.generateObjectMock.mockReset();
    this.calls = [];
  }

  /**
   * Get all calls made to generateObject
   */
  getCalls() {
    return this.calls;
  }

  /**
   * Get the last call made to generateObject
   */
  getLastCall() {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Assert that generateObject was called with specific parameters
   */
  expectCalledWith(expected: {
    prompt?: string | ((actual: string) => boolean);
    schemaName?: string;
    messages?: Message[];
    system?: string;
  }): void {
    const lastCall = this.getLastCall();
    if (!lastCall) {
      throw new Error('No calls made to generateObject');
    }

    if (expected.prompt !== undefined) {
      if (typeof expected.prompt === 'function') {
        expect(expected.prompt(lastCall.params.prompt || '')).toBe(true);
      } else {
        expect(lastCall.params.prompt).toBe(expected.prompt);
      }
    }

    if (expected.schemaName !== undefined) {
      expect(lastCall.params.schemaName).toBe(expected.schemaName);
    }

    if (expected.messages !== undefined) {
      expect(lastCall.params.messages).toEqual(expected.messages);
    }

    if (expected.system !== undefined) {
      expect(lastCall.params.system).toBe(expected.system);
    }
  }

  /**
   * Assert that generateObject was called N times
   */
  expectCallCount(count: number): void {
    expect(this.generateObjectMock).toHaveBeenCalledTimes(count);
  }
}

/**
 * Creates a mock client for testing brains
 */
export function createMockClient(): MockObjectGenerator {
  return new MockObjectGenerator();
}

/**
 * Test adapter that collects brain execution results
 */
class TestAdapter<TState extends State = State> implements Adapter {
  private stepTitles: string[] = [];
  private currentState: TState;
  private completed = false;
  private error: Error | null = null;

  constructor(private initialState: TState) {
    this.currentState = { ...initialState };
  }

  async dispatch(event: BrainEvent): Promise<void> {
    switch (event.type) {
      case BRAIN_EVENTS.STEP_COMPLETE:
        this.stepTitles.push(event.stepTitle);
        if (event.patch && event.patch.length > 0) {
          this.currentState = applyPatches(
            this.currentState,
            event.patch
          ) as TState;
        }
        break;
      case BRAIN_EVENTS.COMPLETE:
        this.completed = true;
        break;
      case BRAIN_EVENTS.ERROR:
        this.error = event.error;
        break;
    }
  }

  getExecutedSteps(): string[] {
    return [...this.stepTitles];
  }

  getFinalState(): TState {
    return { ...this.currentState };
  }

  isCompleted(): boolean {
    return this.completed;
  }

  getError(): Error | null {
    return this.error;
  }
}

/**
 * Test runner options
 */
export interface TestRunnerOptions<TState extends State = State> {
  client?: ObjectGenerator;
  resources?: Resources;
  initialState?: TState;
}

/**
 * Result of running a brain test
 */
export interface TestRunResult<TState extends State = State> {
  finalState: TState;
  steps: string[];
  error: Error | null;
  completed: boolean;
}

/**
 * Runs a brain with test utilities and returns collected data
 */
export async function runBrainTest<
  TOptions extends object = {},
  TState extends State = {}
>(
  brain: Brain<TOptions, TState, any>,
  options: TestRunnerOptions<TState> & { brainOptions?: TOptions } = {}
): Promise<TestRunResult<TState>> {
  const {
    client = createMockClient(),
    resources,
    initialState = {} as TState,
    brainOptions,
  } = options;

  // Create test adapter
  const testAdapter = new TestAdapter<TState>(initialState);

  // Create brain runner with test adapter
  const runner = new BrainRunner({
    adapters: [testAdapter],
    client,
    resources,
  });

  try {
    // Run the brain
    await runner.run(brain, {
      initialState,
      options: brainOptions,
    });
  } catch (error) {
    // Brain might throw after emitting ERROR event
    // This is expected behavior, so we don't re-throw
  }

  return {
    finalState: testAdapter.getFinalState(),
    steps: testAdapter.getExecutedSteps(),
    error: testAdapter.getError(),
    completed: testAdapter.isCompleted(),
  };
}
