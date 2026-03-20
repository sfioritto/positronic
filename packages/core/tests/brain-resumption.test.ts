import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { State } from '../src/dsl/types.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';

describe('brain resumption', () => {
  const mockClient = {
    generateObject: jest.fn(),
    streamText: jest.fn(),
  };

  it('should resume brain from the correct step when given resumeContext', async () => {
    const executedSteps: string[] = [];
    const threeStepBrain = brain('Three Step Brain')
      .step('Step 1', ({ state }) => {
        executedSteps.push('Step 1');
        return { ...state, value: 2 };
      })
      .step('Step 2', ({ state }) => {
        executedSteps.push('Step 2');
        return { ...state, value: state.value + 10 };
      })
      .step('Step 3', ({ state }) => {
        executedSteps.push('Step 3');
        return { ...state, value: state.value * 3 };
      });

    // First run to get the first step completed with initial state
    const initialState = { initialValue: true };
    let stateAfterStep1: State = initialState;

    // Run brain until we get the first step completed
    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      currentUser: { name: 'test-user' },
      initialState,
    })) {
      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.stepTitle === 'Step 1'
      ) {
        stateAfterStep1 = applyPatches(stateAfterStep1, [event.patch]);
        break; // Stop after first step
      }
    }

    // Clear executed steps array
    executedSteps.length = 0;

    // Resume brain from step 1 (stepIndex = 1 means we start at step 2)
    // with the state after step 1 completed
    let resumedState: State = stateAfterStep1;

    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      currentUser: { name: 'test-user' },
      resume: {
        state: stateAfterStep1,
        stepIndex: 1, // Resume from step index 1 (Step 2)
      },
      brainRunId: 'test-run-id',
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        resumedState = applyPatches(resumedState, [event.patch]);
      }
    }

    // Verify only steps 2 and 3 were executed
    expect(executedSteps).toEqual(['Step 2', 'Step 3']);
    expect(executedSteps).not.toContain('Step 1');

    // Verify the final state after all steps complete
    expect(resumedState).toEqual({
      value: 36,
      initialValue: true,
    });
  });
});

describe('IterateResult rehydration on resume', () => {
  it('should re-wrap plain arrays as IterateResult when resuming after a completed map step', async () => {
    const mockClient = {
      generateObject: jest.fn(),
      streamText: jest.fn(),
    };

    const innerBrain = brain<{}, { doubled: number }>('Doubler').step(
      'Double',
      ({ state }) => ({ doubled: state.doubled * 2 })
    );

    // Brain: Init -> MapA -> MapB -> Merge
    // We simulate resuming at MapB (stepIndex: 2), meaning MapA already completed.
    // MapA's results are in state as a plain array (from JSON patch reconstruction).
    const outerBrain = brain('RehydrationTest')
      .step('Init', () => ({
        itemsA: [{ id: 'a1' }, { id: 'a2' }],
        itemsB: [{ id: 'b1' }],
      }))
      .map('MapA', 'resultsA' as const, ({ state }) => ({
        run: innerBrain,
        over: state.itemsA,
        initialState: (item: any) => ({ doubled: 1 }),
      }))
      .map('MapB', 'resultsB' as const, ({ state }) => ({
        run: innerBrain,
        over: state.itemsB,
        initialState: (item: any) => ({ doubled: 3 }),
      }))
      .step('Merge', ({ state }) => {
        // This uses IterateResult.map() — would break with Array.prototype.map
        const idsA = state.resultsA.map((item, result) => item.id);
        const idsB = state.resultsB.map((item, result) => item.id);
        return { ...state, mergedIds: [...idsA, ...idsB] };
      });

    // Resume at step 2 (MapB). State contains MapA's results as a PLAIN ARRAY
    // (simulating what happens when state is reconstructed from JSON patches).
    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient as ObjectGenerator,
      currentUser: { name: 'test-user' },
      resume: {
        state: {
          itemsA: [{ id: 'a1' }, { id: 'a2' }],
          itemsB: [{ id: 'b1' }],
          // This is what IterateResult.toJSON() produces — a plain array of tuples.
          // After JSON patch reconstruction, it's just a regular array.
          resultsA: [
            [{ id: 'a1' }, { doubled: 2 }],
            [{ id: 'a2' }, { doubled: 2 }],
          ],
        },
        stepIndex: 2, // Skip Init and MapA, resume at MapB
      },
      brainRunId: 'test-rehydrate',
    })) {
      events.push(event);
    }

    // Verify no errors
    const errorEvents = events.filter((e) => e.type === BRAIN_EVENTS.ERROR);
    expect(errorEvents).toHaveLength(0);

    // The Merge step's patch should contain the expected mergedIds,
    // proving IterateResult.map() worked on the rehydrated resultsA.
    const mergeComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Merge'
    ) as any;
    expect(mergeComplete).toBeDefined();
    expect(mergeComplete.patch).toBeDefined();

    // Apply only the Merge step's patch to see what it produced
    const stateBeforeMerge = {
      itemsA: [{ id: 'a1' }, { id: 'a2' }],
      itemsB: [{ id: 'b1' }],
      resultsA: [
        [{ id: 'a1' }, { doubled: 2 }],
        [{ id: 'a2' }, { doubled: 2 }],
      ],
      resultsB: [[{ id: 'b1' }, { doubled: 6 }]],
    };
    const finalState = applyPatches(stateBeforeMerge, [
      mergeComplete.patch,
    ]) as any;
    expect(finalState.mergedIds).toEqual(['a1', 'a2', 'b1']);
  });
});
