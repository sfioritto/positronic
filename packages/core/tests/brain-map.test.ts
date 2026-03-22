import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';
import {
  finalStateFromEvents,
  mockGenerateObject,
  mockClient,
} from './brain-test-helpers.js';

describe('.map()', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
  });

  // Helper: run brain, feed events into state machine, return { events, finalState }
  const runWithStateMachine = async (brainInstance: any, runParams: any) => {
    const sm = createBrainExecutionMachine();
    const events: BrainEvent<any>[] = [];
    for await (const event of brainInstance.run(runParams)) {
      events.push(event);
      sendEvent(sm, event as any);
    }
    return { events, finalState: sm.context.currentState as any, sm };
  };

  it('should run inner brain per item and collect results as tuples', async () => {
    const innerBrain = brain<{}, { value: number }>('Doubler').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: [{ n: 3 }, { n: 5 }, { n: 7 }],
      }))
      .map('Process Items', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.results).toHaveLength(3);
    expect(finalState.results[0]).toEqual([{ n: 3 }, { value: 6 }]);
    expect(finalState.results[1]).toEqual([{ n: 5 }, { value: 10 }]);
    expect(finalState.results[2]).toEqual([{ n: 7 }, { value: 14 }]);
  });

  it('should forward inner brain events', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value + 1 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const { events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Should see inner brain START events for each item
    const innerStarts = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.START &&
        'brainTitle' in e &&
        e.brainTitle === 'Inner'
    );
    expect(innerStarts).toHaveLength(2);

    // Should see inner brain COMPLETE events for each item
    const innerCompletes = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Inner'
    );
    expect(innerCompletes).toHaveLength(2);

    // Should see STEP_COMPLETE for inner brain steps
    const innerStepCompletes = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Process'
    );
    expect(innerStepCompletes).toHaveLength(2);
  });

  it('should emit ITERATE_ITEM_COMPLETE per item', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value * 10 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const { events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    const iterateEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );

    expect(iterateEvents).toHaveLength(3);
    expect((iterateEvents[0] as any).itemIndex).toBe(0);
    expect((iterateEvents[0] as any).processedCount).toBe(1);
    expect((iterateEvents[0] as any).totalItems).toBe(3);
    expect((iterateEvents[0] as any).result).toEqual({ value: 10 });
    expect((iterateEvents[0] as any).stateKey).toBe('results');

    expect((iterateEvents[1] as any).itemIndex).toBe(1);
    expect((iterateEvents[1] as any).processedCount).toBe(2);
    expect((iterateEvents[1] as any).result).toEqual({ value: 20 });

    expect((iterateEvents[2] as any).itemIndex).toBe(2);
    expect((iterateEvents[2] as any).processedCount).toBe(3);
    expect((iterateEvents[2] as any).result).toEqual({ value: 30 });
  });

  it('should use error handler as fallback when item fails', async () => {
    let callCount = 0;
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => {
        callCount++;
        if (callCount === 2) throw new Error('Item 2 failed');
        return { value: state.value * 2 };
      }
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
        error: (item, err) => ({ value: -1 }),
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    ) as any[];
    expect(itemEvents).toHaveLength(3);
    expect(itemEvents[0].result).toEqual({ value: 2 });
    expect(itemEvents[1].result).toEqual({ value: -1 }); // fallback
    expect(itemEvents[2].result).toEqual({ value: 6 });
  });

  it('should skip item when error handler returns null', async () => {
    let callCount = 0;
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => {
        callCount++;
        if (callCount === 2) throw new Error('Skip me');
        return { value: state.value };
      }
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
        error: () => null,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    ) as any[];
    expect(itemEvents).toHaveLength(3);
    // Item 2 has undefined result (skipped)
    expect(itemEvents[0].result).toEqual({ value: 1 });
    expect(itemEvents[1].result).toBeUndefined();
    expect(itemEvents[2].result).toEqual({ value: 3 });
  });

  it('should stop on PAUSE between items', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value })
    );

    let controlSignalCallCount = 0;
    const mockSignalProvider = {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          // 1 = main loop before Init
          // 2 = main loop before map step
          // 3 = map before first item
          // 4 = map before second item — PAUSE here
          if (controlSignalCallCount === 4) {
            return [{ type: 'PAUSE' as const }];
          }
        }
        if (filter === 'WEBHOOK') return [];
        return [];
      },
    };

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      signalProvider: mockSignalProvider,
    })) {
      events.push(event);
    }

    // Should have processed 1 item before PAUSE stopped
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(1);

    // No PAUSED event (silent stop for backend restart)
    expect(events.some((e) => e.type === BRAIN_EVENTS.PAUSED)).toBe(false);

    // No outer brain COMPLETE event (inner brain completes are expected)
    const outerComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer'
    );
    expect(outerComplete).toBeUndefined();
  });

  it('should stop on KILL signal', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value })
    );

    let controlSignalCallCount = 0;
    const mockSignalProvider = {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          if (controlSignalCallCount === 4) {
            return [{ type: 'KILL' as const }];
          }
        }
        if (filter === 'WEBHOOK') return [];
        return [];
      },
    };

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      signalProvider: mockSignalProvider,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === BRAIN_EVENTS.CANCELLED)).toBe(true);
    // No outer brain COMPLETE event
    const outerComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer'
    );
    expect(outerComplete).toBeUndefined();
  });

  it('should throw on inner brain webhook', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner')
      .step('Process', ({ state }) => state)
      .wait('Wait for webhook', () => ({
        slug: 'test',
        identifier: 'test-id',
        schema: z.object({ data: z.string() }),
        token: 'token',
      }))
      .handle('After webhook', ({ state }) => state);

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }] }))
      .map('Iterate', 'results' as const, ({ state }: any) => ({
        run: innerBrain as any,
        over: state.items,
        initialState: (item: any) => ({ value: item.n }),
      }));

    let error: Error | undefined;
    try {
      for await (const event of outerBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })) {
        // consume events
      }
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).toContain(
      'Webhook/wait inside .map() is not supported'
    );
  });

  it('should resume from iterateProgress', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }))
      .map('Iterate', 'results' as const, ({ state }) => ({
        run: innerBrain,
        over: state.items,
        initialState: (item) => ({ value: item.n }),
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      resume: {
        state: { items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] },
        stepIndex: 1,
        iterateProgress: {
          accumulatedResults: [
            [{ n: 1 }, { value: 2 }],
            [{ n: 2 }, { value: 4 }],
            undefined,
            undefined,
          ],
          processedCount: 2,
          totalItems: 4,
          stateKey: 'results',
        },
      },
      brainRunId: 'test-resume',
    })) {
      events.push(event);
    }

    // Should only have processed 2 remaining items
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(2);
    expect((itemEvents[0] as any).itemIndex).toBe(2);
    expect((itemEvents[0] as any).processedCount).toBe(3);
    expect((itemEvents[1] as any).itemIndex).toBe(3);
    expect((itemEvents[1] as any).processedCount).toBe(4);

    // Verify all 4 results present in the outer step complete patch
    const outerStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Iterate'
    );
    expect(outerStepComplete).toBeDefined();
  });

  // Helper: signal provider that PAUSEs on the Nth CONTROL signal check.
  function createPausingSignalProvider(pauseOnCall: number) {
    let controlSignalCallCount = 0;
    return {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          if (controlSignalCallCount === pauseOnCall) {
            return [{ type: 'PAUSE' as const }];
          }
        }
        return [];
      },
    };
  }

  it.each([
    {
      label: 'step throws',
      makeInnerBrain: () => {
        let callCount = 0;
        return brain<{}, { value: number }>('FailInner').step(
          'Process',
          ({ state }) => {
            callCount++;
            if (callCount === 2) throw new Error('Item 2 exploded');
            return { value: state.value * 2 };
          }
        );
      },
      makeOuterBrain: (innerBrain: any) =>
        brain('StackOuter')
          .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
          .map('Iterate', 'results' as const, ({ state }) => ({
            run: innerBrain,
            over: state.items,
            initialState: (item: any) => ({ value: item.n }),
            error: () => ({ value: -1 }),
          })),
      clientOverride: undefined as any,
    },
  ])(
    'should keep execution stack balanced when $label',
    async ({ makeInnerBrain, makeOuterBrain, clientOverride }) => {
      const signalProvider = createPausingSignalProvider(5);
      const innerBrain = makeInnerBrain();
      const outerBrain = makeOuterBrain(innerBrain);
      const client = clientOverride ? clientOverride() : mockClient;

      const { events, sm } = await runWithStateMachine(outerBrain, {
        client,
        currentUser: { name: 'test-user' },
        signalProvider,
      });

      const itemEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
      );
      expect(itemEvents).toHaveLength(2);

      expect(sm.context.executionStack).toHaveLength(1);
      expect(sm.context.executionStack[0].stepIndex).toBe(1);
      expect(sm.context.iterateContext).not.toBeNull();
      expect(sm.context.iterateContext!.processedCount).toBe(2);
      expect(sm.context.iterateContext!.totalItems).toBe(3);
    }
  );

  it('should run prompt per item in prompt mode', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { category: 'work', priority: 'high' },
      })
      .mockResolvedValueOnce({
        object: { category: 'personal', priority: 'low' },
      });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        emails: [
          { subject: 'Meeting tomorrow', from: 'boss@work.com' },
          { subject: 'Weekend plans', from: 'friend@home.com' },
        ],
      }))
      .map('Categorize', 'categories' as const, ({ state }) => ({
        prompt: {
          message: (item: { subject: string; from: string }) =>
            `Categorize: ${item.subject} from ${item.from}`,
          outputSchema: z.object({
            category: z.string(),
            priority: z.enum(['high', 'medium', 'low']),
          }),
        },
        over: state.emails,
      }));

    const { finalState, events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Results are IterateResult tuples
    expect(finalState.categories).toHaveLength(2);
    expect(finalState.categories[0]).toEqual([
      { subject: 'Meeting tomorrow', from: 'boss@work.com' },
      { category: 'work', priority: 'high' },
    ]);
    expect(finalState.categories[1]).toEqual([
      { subject: 'Weekend plans', from: 'friend@home.com' },
      { category: 'personal', priority: 'low' },
    ]);

    // Should emit ITERATE_ITEM_COMPLETE for each item
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(2);

    // No inner brain events (no START/COMPLETE from inner brain)
    const innerBrainStarts = events.filter(
      (e) => e.type === BRAIN_EVENTS.START && (e as any).brainTitle !== 'Outer'
    );
    expect(innerBrainStarts).toHaveLength(0);

    // generateObject called twice
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('should handle errors in prompt mode with error callback', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { summary: 'Good result' },
      })
      .mockRejectedValueOnce(new Error('LLM error'))
      .mockResolvedValueOnce({
        object: { summary: 'Another result' },
      });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: ['a', 'b', 'c'],
      }))
      .map('Summarize', 'summaries' as const, ({ state }) => ({
        prompt: {
          message: (item: string) => `Summarize: ${item}`,
          outputSchema: z.object({ summary: z.string() }),
        },
        over: state.items,
        error: () => ({ summary: 'fallback' }),
      }));

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.summaries).toHaveLength(3);
    expect(finalState.summaries[0]).toEqual(['a', { summary: 'Good result' }]);
    expect(finalState.summaries[1]).toEqual(['b', { summary: 'fallback' }]);
    expect(finalState.summaries[2]).toEqual([
      'c',
      { summary: 'Another result' },
    ]);
  });

  it('should use per-step client override in prompt mode', async () => {
    const customMockGenerateObject =
      jest.fn<ObjectGenerator['generateObject']>();
    const customClient: jest.Mocked<ObjectGenerator> = {
      generateObject: customMockGenerateObject,
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    customMockGenerateObject.mockResolvedValue({
      object: { result: 'from custom client' },
    });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: [{ n: 1 }],
      }))
      .map('Process', 'results' as const, ({ state }) => ({
        prompt: {
          message: (item: { n: number }) => `Process: ${item.n}`,
          outputSchema: z.object({ result: z.string() }),
        },
        client: customClient,
        over: state.items,
      }));

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Custom client was used, not the default one
    expect(customMockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(finalState.results[0]).toEqual([
      { n: 1 },
      { result: 'from custom client' },
    ]);
  });

  it('should work in brain mode when the parent brain runs as a child via .brain()', async () => {
    const processBrain = brain<{}, { value: number }>('MapChild').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const innerBrain = brain('MapParent')
      .step('Init', () => ({
        items: [{ value: 1 }, { value: 2 }, { value: 3 }],
      }))
      .map('Process items', 'results' as const, ({ state }) => ({
        run: processBrain,
        over: state.items,
        initialState: (item) => item,
        error: () => null,
      }))
      .step('Summarize', ({ state }) => ({
        ...state,
        total: state.results.values.reduce(
          (sum: number, r: any) => sum + r.value,
          0
        ),
      }));

    const outerBrain = brain('MapOuter').brain('Run inner', innerBrain);

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.total).toBe(12);
  });
});

describe('IterateResult', () => {
  it('should provide .values, .filter().items, .length, and .map() during live execution', async () => {
    // Inner brain that produces a summary field
    const summarizeBrain = brain<{}, { summary: string }>('Summarizer').step(
      'Summarize',
      ({ state }) => ({ summary: 'test summary' })
    );

    const testBrain = brain('IterateResult Integration')
      .step('Init', () => ({
        items: [
          { name: 'alpha', important: true },
          { name: 'beta', important: false },
          { name: 'gamma', important: true },
        ],
      }))
      .map('Summarize', 'results' as const, ({ state }) => ({
        run: summarizeBrain,
        over: state.items,
        initialState: (item: any) => ({ summary: '' }),
      }))
      .step('Use IterateResult API', ({ state }) => {
        const summaries = state.results.values.map((r: any) => r.summary);
        const importantNames = state.results
          .filter((item) => item.important)
          .items.map((i) => i.name);
        const labels = state.results.map(
          (item, r) => `${item.name}:${r.summary}`
        );

        return {
          ...state,
          summaries,
          importantNames,
          count: state.results.length,
          labels,
        };
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const finalState = finalStateFromEvents(events);
    expect(finalState.summaries).toEqual([
      'test summary',
      'test summary',
      'test summary',
    ]);
    expect(finalState.importantNames).toEqual(['alpha', 'gamma']);
    expect(finalState.count).toBe(3);
    expect(finalState.labels).toEqual([
      'alpha:test summary',
      'beta:test summary',
      'gamma:test summary',
    ]);
  });
});
