import type { ObjectGenerator, Message } from './clients/types.js';
import { z } from 'zod';
import { jest } from '@jest/globals';

/**
 * Helper function to get the next value from an AsyncIterator.
 * Throws an error if the iterator is done.
 */
export const nextStep = async <T>(brainRun: AsyncIterator<T>): Promise<T> => {
  const result = await brainRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};

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
    responses.forEach(response => {
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
