import { jest } from '@jest/globals';
import { brain } from '../src/dsl/builder/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type { CurrentUser } from '../src/dsl/types.js';
import type { BrainStartEvent } from '../src/dsl/definitions/events.js';

// Helper function to collect all events from a brain run
const collectEvents = async <T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
};

// Mock ObjectGenerator for testing
const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('currentUser', () => {
  it('should be available in step context when provided via run params', async () => {
    const mockClient = createMockClient();
    let receivedUser: CurrentUser | undefined;

    const testBrain = brain('test-brain').step(
      'Check User',
      ({ currentUser }) => {
        receivedUser = currentUser;
        return { done: true };
      }
    );

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'user-123' },
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(receivedUser).toEqual({ name: 'user-123' });
  });

  it('should appear in the START event payload', async () => {
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step('Noop', () => ({ done: true }));

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'user-456' },
      })
    );

    const startEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.START
    ) as BrainStartEvent;
    expect(startEvent).toBeDefined();
    expect(startEvent.currentUser).toEqual({ name: 'user-456' });
  });

  it('should persist through step chains (same value in all steps)', async () => {
    const mockClient = createMockClient();
    const usersReceived: (CurrentUser | undefined)[] = [];

    const testBrain = brain('test-brain')
      .step('Step 1', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 1 };
      })
      .step('Step 2', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 2 };
      })
      .step('Step 3', ({ currentUser }) => {
        usersReceived.push(currentUser);
        return { step: 3 };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
        currentUser: { name: 'persistent-user' },
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(usersReceived).toHaveLength(3);
    expect(usersReceived[0]).toEqual({ name: 'persistent-user' });
    expect(usersReceived[1]).toEqual({ name: 'persistent-user' });
    expect(usersReceived[2]).toEqual({ name: 'persistent-user' });
  });
});
