import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { MockSignalProvider } from './mock-signal-provider.js';
import { jest } from '@jest/globals';
import type { ObjectGenerator } from '../src/clients/types.js';

// Mock ObjectGenerator
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

describe('signal handling', () => {
  let signalProvider: MockSignalProvider;

  beforeEach(() => {
    mockGenerateObject.mockReset();
    signalProvider = new MockSignalProvider();
  });

  describe('KILL signal in main loop', () => {
    it('should terminate brain between steps when KILL signal is received', async () => {
      const testBrain = brain('test-kill')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }))
        .step('Step 3', () => ({ step3: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        signalProvider,
      })) {
        events.push(event);

        // Queue KILL signal after step 1 completes - will be picked up before step 2
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'KILL' });
        }
      }

      // Should have CANCELLED event
      const cancelledEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.CANCELLED
      );
      expect(cancelledEvent).toBeDefined();
      expect(cancelledEvent?.status).toBe(STATUS.CANCELLED);

      // Should NOT have COMPLETE event
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeUndefined();

      // Only step 1 should complete (KILL is checked before step 2)
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(1);
    });
  });

  describe('PAUSE signal in main loop', () => {
    it('should pause brain between steps when PAUSE signal is received', async () => {
      const testBrain = brain('test-pause')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        signalProvider,
      })) {
        events.push(event);

        // Queue PAUSE signal after step 1 completes
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'PAUSE' });
        }
      }

      // Should have PAUSED event
      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeDefined();
      expect(pausedEvent?.status).toBe(STATUS.PAUSED);

      // Should NOT have COMPLETE event
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeUndefined();

      // Only step 1 should complete
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(1);
    });
  });

  describe('signal priority', () => {
    it('should process KILL before PAUSE when both are queued', async () => {
      const testBrain = brain('test-priority')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        signalProvider,
      })) {
        events.push(event);

        // Queue signals in reverse priority order after step 1
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'PAUSE' });
          signalProvider.queueSignal({ type: 'KILL' });
        }
      }

      // Should have CANCELLED (from KILL), not PAUSED
      const cancelledEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.CANCELLED
      );
      expect(cancelledEvent).toBeDefined();

      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeUndefined();
    });
  });

  describe('no signal provider', () => {
    it('should run normally when no signal provider is set', async () => {
      const testBrain = brain('test-no-signals')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        // No signalProvider
      })) {
        events.push(event);
      }

      // Should complete normally
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();

      // Should have 2 step completions
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(2);
    });
  });
});
