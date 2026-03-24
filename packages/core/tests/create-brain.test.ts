import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { createBrain } from '../src/dsl/create-brain.js';
import { definePlugin } from '../src/plugins/define-plugin.js';
import { jest } from '@jest/globals';
import { mockClient } from './brain-test-helpers.js';

describe('createBrain plugin type inference', () => {
  it('should propagate plugin types from createBrain to all brains', async () => {
    const logMock = jest.fn();
    const logger = definePlugin({
      name: 'logger',
      create: () => ({ log: logMock }),
    });

    const brain = createBrain({
      plugins: [logger],
    });

    // The key test: destructuring { logger } should be typed correctly
    // without needing .withPlugin()
    const testBrain = brain('Plugin Type Test').step(
      'Use plugin',
      ({ logger }) => {
        logger.log('hello from createBrain');
        return { pluginUsed: true };
      }
    );

    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(logMock).toHaveBeenCalledWith('hello from createBrain');
    expect(finalState).toEqual({ pluginUsed: true });
  });

  it('should propagate multiple plugin types', async () => {
    const logMock = jest.fn();
    const trackMock = jest.fn();

    const logger = definePlugin({
      name: 'logger',
      create: () => ({ log: logMock }),
    });

    const tracker = definePlugin({
      name: 'tracker',
      create: () => ({ track: trackMock }),
    });

    const brain = createBrain({
      plugins: [logger, tracker],
    });

    const testBrain = brain('Multi Plugin Test').step(
      'Use both',
      ({ logger, tracker }) => {
        logger.log('logged');
        tracker.track('tracked');
        return { bothUsed: true };
      }
    );

    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(logMock).toHaveBeenCalledWith('logged');
    expect(trackMock).toHaveBeenCalledWith('tracked');
    expect(finalState).toEqual({ bothUsed: true });
  });

  it('should propagate plugin types with setup config', async () => {
    const apiPlugin = definePlugin({
      name: 'api',
      setup: (config: { baseUrl: string }) => config,
      create: ({ config }) => ({
        url: config.baseUrl,
        fetch: async (path: string) => `${config.baseUrl}${path}`,
      }),
    });

    const brain = createBrain({
      plugins: [apiPlugin.setup({ baseUrl: 'https://example.com' })],
    });

    let capturedUrl: string | undefined;
    const testBrain = brain('Setup Plugin Test').step('Use api', ({ api }) => {
      capturedUrl = api.url;
      return { url: api.url };
    });

    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      // consume events
    }

    expect(capturedUrl).toBe('https://example.com');
  });

  it('should work with no plugins', async () => {
    const brain = createBrain({});

    const testBrain = brain('No Plugins').step('Simple', () => ({
      value: 42,
    }));

    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toEqual({ value: 42 });
  });

  it('should allow per-brain withPlugin to add more plugins', async () => {
    const logMock = jest.fn();
    const trackMock = jest.fn();

    const logger = definePlugin({
      name: 'logger',
      create: () => ({ log: logMock }),
    });

    const tracker = definePlugin({
      name: 'tracker',
      create: () => ({ track: trackMock }),
    });

    const brain = createBrain({
      plugins: [logger],
    });

    // Add tracker per-brain via withPlugin
    const testBrain = brain('Mixed Plugins')
      .withPlugin(tracker)
      .step('Use both', ({ logger, tracker }) => {
        logger.log('from factory');
        tracker.track('from withPlugin');
        return { mixed: true };
      });

    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(logMock).toHaveBeenCalledWith('from factory');
    expect(trackMock).toHaveBeenCalledWith('from withPlugin');
    expect(finalState).toEqual({ mixed: true });
  });
});
