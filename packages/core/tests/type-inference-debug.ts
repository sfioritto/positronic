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
      '1': {
        id: '1',
        from: 'alice@test.com',
        subject: 'Hello',
        body: 'Hi there',
      },
      '2': {
        id: '2',
        from: 'bob@test.com',
        subject: 'Meeting',
        body: 'Tomorrow at 10',
      },
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

// Test 3: Step → .map() with prompt (flat config)
const test3 = brain('test-3')
  .step('Fetch threads', ({ state }) => {
    const threadsById: Record<string, RawThread> = {
      '1': {
        id: '1',
        from: 'alice@test.com',
        subject: 'Hello',
        body: 'Hi there',
      },
      '2': {
        id: '2',
        from: 'bob@test.com',
        subject: 'Meeting',
        body: 'Tomorrow at 10',
      },
    };
    return {
      ...state,
      threadsById,
    };
  })
  .map('Categorize', 'categoryResult' as const, ({ state }) => ({
    prompt: {
      message: (item: RawThread) =>
        `Categorize this email:\nFrom: ${item.from}\nSubject: ${item.subject}`,
      outputSchema: z.object({
        category: z.string(),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    },
    over: Object.values(state.threadsById),
  }));

// Test 4: Single prompt followed by step
const test4 = brain('test-4')
  .step('Initialize', () => ({
    count: 5,
    items: ['a', 'b', 'c'],
  }))
  .prompt('Summarize', ({ state }) => ({
    message: `Count is ${state.count}`,
    outputSchema: z.object({ summary: z.string() }),
  }))
  .step('After prompt', ({ state }) => {
    // state.summary should be string (spread from outputSchema)
    const summaryText: string = state.summary;
    // state.count should still be number
    const count: number = state.count;
    return {
      ...state,
      processed: true,
    };
  });

// Test 5: .map() with prompt followed by step
const test5 = brain('test-5')
  .step('Initialize', () => ({
    items: ['a', 'b', 'c'],
  }))
  .map('Process items', 'results' as const, ({ state }) => ({
    prompt: {
      message: (item: string) => `Process: ${item}`,
      outputSchema: z.object({ result: z.string() }),
    },
    over: state.items,
  }))
  .step('After batch prompt', ({ state }) => {
    // state.results is an IterateResult<string, { result: string }>
    const results = state.results;

    // Access first item and result via IterateResult API
    const firstItem: string = results.items[0];
    const firstResult: string = results.values[0].result;

    return {
      ...state,
      totalResults: results.length,
    };
  });

// Test 6: Multiple .map() prompts in sequence
const test6 = brain('test-6')
  .step('Initialize', () => ({
    threads: [
      { id: '1', from: 'alice@test.com', subject: 'Hello', body: 'Hi' },
    ] as RawThread[],
  }))
  .map('First categorize', 'firstCategories' as const, ({ state }) => ({
    prompt: {
      message: (item: RawThread) => `Categorize: ${item.subject}`,
      outputSchema: z.object({
        category: z.string(),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    },
    over: state.threads,
  }))
  .step('After first prompt', ({ state }) => {
    // state.firstCategories should be the batch results
    const categories = state.firstCategories;
    return {
      ...state,
      categorizedCount: categories.length,
    };
  })
  .map('Second categorize', 'secondCategories' as const, ({ state }) => ({
    prompt: {
      message: (item: RawThread) => `Re-categorize: ${item.subject}`,
      outputSchema: z.object({
        category: z.string(),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    },
    over: state.threads,
  }));

// Export to prevent unused variable warnings
export { test1, test2, test3, test4, test5, test6 };
