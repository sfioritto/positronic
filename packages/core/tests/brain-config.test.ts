import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { brain } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { mockClient, testLogger } from './brain-test-helpers.js';

describe('brain options', () => {
  it('should pass options through to brain events', async () => {
    const optionsSchema = z.object({
      testOption: z.string(),
    });

    const testBrain = brain('Options Brain')
      .withOptions(optionsSchema)
      .step('Simple step', ({ state, options }) => ({
        value: 1,
        passedOption: options.testOption,
      }));

    const brainOptions = {
      testOption: 'test-value',
    };

    let finalEvent, finalStepStatus;
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: brainOptions,
    })) {
      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      } else {
        finalEvent = event;
      }
    }

    expect(finalEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle: 'Options Brain',
        brainDescription: undefined,
        options: brainOptions,
      })
    );
    expect(finalStepStatus).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: [
          expect.objectContaining({
            title: 'Simple step',
            status: STATUS.COMPLETE,
          }),
        ],
        options: brainOptions,
      })
    );
  });

  it('should provide empty object as default options', async () => {
    const testBrain = brain('Default Options Brain').step(
      'Simple step',
      ({ options }) => ({
        hasOptions: Object.keys(options).length === 0,
      })
    );

    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Skip start event
    await brainRun.next();

    // Skip initial step status event
    await brainRun.next();

    // Check step start
    const stepStartResult = await brainRun.next();
    expect(stepStartResult.value).toEqual(
      expect.objectContaining({
        options: {},
        type: BRAIN_EVENTS.STEP_START,
      })
    );

    // Check step status (running) (options test)
    const stepStatusRunning = await brainRun.next();
    expect(stepStatusRunning.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      })
    );
    if (stepStatusRunning.value.type === BRAIN_EVENTS.STEP_STATUS) {
      expect(stepStatusRunning.value.steps[0].status).toBe(STATUS.RUNNING);
    }

    // Check step completion
    const stepResult = await brainRun.next();
    expect(stepResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'Simple step',
        options: {},
      })
    );
  });
});

describe('services support', () => {
  it('should allow adding custom services to brains', async () => {
    // Create a brain with services
    const testBrain = brain('Services Test')
      .withServices({
        logger: testLogger,
      })
      .step('Use service', ({ state, logger }) => {
        logger.log('Test service called');
        return { serviceUsed: true };
      });

    // Run the brain and collect events
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the service was called
    expect(testLogger.log).toHaveBeenCalledWith('Test service called');

    // Verify the state was updated
    expect(finalState).toEqual({ serviceUsed: true });
  });

  it('should propagate services from parent to child brain', async () => {
    let childReceivedApi: string | undefined;

    const childBrain = brain('Child Brain').step(
      'Use parent service',
      (params: any) => {
        childReceivedApi = params.api;
        return { childDone: true };
      }
    );

    const parentBrain = brain('Parent Brain')
      .withServices({ api: 'parent-api-url' })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    expect(childReceivedApi).toBe('parent-api-url');
  });

  it('should allow child services to override parent services', async () => {
    let childReceivedApi: string | undefined;

    const childBrain = brain('Override Child')
      .withServices({ api: 'child-api-url' })
      .step('Use service', (params: any) => {
        childReceivedApi = params.api;
        return { childDone: true };
      });

    const parentBrain = brain('Override Parent')
      .withServices({ api: 'parent-api-url' })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    // Child's own withServices() should win over parent's
    expect(childReceivedApi).toBe('child-api-url');
  });

  it('should make parent services available to child without withServices', async () => {
    let childReceivedLogger: any;

    const childBrain = brain('No Services Child').step(
      'Check for service',
      (params: any) => {
        childReceivedLogger = params.logger;
        return { checked: true };
      }
    );

    const parentBrain = brain('Provides Services Parent')
      .withServices({ logger: testLogger })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    expect(childReceivedLogger).toBe(testLogger);
  });

  it('should propagate storeProvider to nested brains', async () => {
    const storeData = new Map<string, any>();
    const mockStoreProvider = (config: any) => ({
      get: async (key: string) => storeData.get(`${config.brainTitle}:${key}`),
      set: async (key: string, value: any) => {
        storeData.set(`${config.brainTitle}:${key}`, value);
      },
      delete: async (key: string) => {
        storeData.delete(`${config.brainTitle}:${key}`);
      },
      has: async (key: string) => storeData.has(`${config.brainTitle}:${key}`),
    });

    const childBrain = brain('Store Child')
      .withStore({ counter: z.number() })
      .step('Write store', async ({ store }) => {
        await store!.set('counter', 42);
        return { stored: true };
      });

    const parentBrain = brain('Store Parent')
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      providers: { store: mockStoreProvider },
    })) {
    }

    expect(storeData.get('Store Child:counter')).toBe(42);
  });
});
