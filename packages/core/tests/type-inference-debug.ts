/**
 * Type inference debugging file.
 * This file tests type inference through step → prompt chains.
 * Run `npm run typecheck` to verify types are working correctly.
 *
 * If type inference breaks, you'll see TypeScript errors here.
 */

import { brain } from '../src/dsl/brain.js';
import { z } from 'zod';

// Simulating a RawThread type like in email-digest
interface RawThread {
  id: string;
  from: string;
  subject: string;
  body: string;
}

// Simulating a categorization prompt
const categorizePrompt = {
  template: (thread: RawThread) =>
    `Categorize this email:\nFrom: ${thread.from}\nSubject: ${thread.subject}`,
  outputSchema: {
    schema: z.object({
      category: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
    }),
    name: 'categoryResult' as const,
  },
};

// Test 1: Simple step → step chain
// This should properly infer state types
const test1 = brain('test-1')
  .step('Initialize', ({ state }) => ({
    ...state,
    initialized: true,
    count: 0,
  }))
  .step('Increment', ({ state }) => {
    // state.count should be number
    const count: number = state.count;
    // state.initialized should be boolean
    const init: boolean = state.initialized;
    return {
      ...state,
      count: count + 1,
    };
  });

// Test 2: Step that returns a Record type (like email-digest)
// This is the pattern that was breaking
const test2 = brain('test-2')
  .step('Fetch threads', ({ state }) => {
    const threadsById: Record<string, RawThread> = {
      '1': { id: '1', from: 'alice@test.com', subject: 'Hello', body: 'Hi there' },
      '2': { id: '2', from: 'bob@test.com', subject: 'Meeting', body: 'Tomorrow at 10' },
    };
    return {
      ...state,
      threadsById,
    };
  })
  .step('Access threads', ({ state }) => {
    // This should work if type inference is correct
    // If state is JsonObject, this would require a cast
    const threads = Object.values(state.threadsById);

    // Each thread should be RawThread
    const firstThread = threads[0];
    // These accesses should type-check without casts
    const subject: string = firstThread.subject;
    const from: string = firstThread.from;

    return {
      ...state,
      threadCount: threads.length,
      firstSubject: subject,
    };
  });

// Test 3: Step → batch prompt chain (the problematic pattern)
const test3 = brain('test-3')
  .step('Fetch threads', ({ state }) => {
    const threadsById: Record<string, RawThread> = {
      '1': { id: '1', from: 'alice@test.com', subject: 'Hello', body: 'Hi there' },
      '2': { id: '2', from: 'bob@test.com', subject: 'Meeting', body: 'Tomorrow at 10' },
    };
    return {
      ...state,
      threadsById,
    };
  })
  .prompt('Categorize', categorizePrompt, {
    // This is where the issue manifests:
    // If state is JsonObject, we'd need to cast state.threadsById
    over: (state) => Object.values(state.threadsById),
  });

// Test 4: Single prompt followed by batch prompt
const singlePrompt = {
  template: (state: { count: number }) => `Count is ${state.count}`,
  outputSchema: {
    schema: z.object({ summary: z.string() }),
    name: 'summary' as const,
  },
};

const test4 = brain('test-4')
  .step('Initialize', () => ({
    count: 5,
    items: ['a', 'b', 'c'],
  }))
  .prompt('Summarize', singlePrompt)
  .step('After prompt', ({ state }) => {
    // state.summary should be { summary: string }
    const summaryText: string = state.summary.summary;
    // state.count should still be number
    const count: number = state.count;
    return {
      ...state,
      processed: true,
    };
  });

// Test 5: Batch prompt followed by step
const itemPrompt = {
  template: (item: string) => `Process: ${item}`,
  outputSchema: {
    schema: z.object({ result: z.string() }),
    name: 'results' as const,
  },
};

const test5 = brain('test-5')
  .step('Initialize', () => ({
    items: ['a', 'b', 'c'],
  }))
  .prompt('Process items', itemPrompt, {
    over: (state) => state.items,
  })
  .step('After batch prompt', ({ state }) => {
    // state.results should be [string, { result: string }][]
    const results = state.results;

    // Access first tuple
    const [firstItem, firstResult] = results[0];
    const itemValue: string = firstItem;
    const resultValue: string = firstResult.result;

    return {
      ...state,
      totalResults: results.length,
    };
  });

// Test 6: Multiple prompts in sequence
const test6 = brain('test-6')
  .step('Initialize', () => ({
    threads: [
      { id: '1', from: 'alice@test.com', subject: 'Hello', body: 'Hi' },
    ] as RawThread[],
  }))
  .prompt('First categorize', categorizePrompt, {
    over: (state) => state.threads,
  })
  .step('After first prompt', ({ state }) => {
    // state.categoryResult should be the batch results
    const categories = state.categoryResult;
    return {
      ...state,
      categorizedCount: categories.length,
    };
  })
  .prompt('Second categorize', categorizePrompt, {
    // Should still have access to threads
    over: (state) => state.threads,
  });

// Export to prevent unused variable warnings
export { test1, test2, test3, test4, test5, test6 };
