import { brain } from '../src/dsl/brain.js';
import { definePlugin } from '../src/plugins/define-plugin.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import {
  mockClient,
  mockGenerateObject,
  runWithStateMachine,
  AssertEquals,
} from './brain-test-helpers.js';
import type { PluginInjection } from '../src/plugins/types.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';

describe('plugin system', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
  });

  describe('definePlugin', () => {
    it('should create a plugin without setup', () => {
      const logger = definePlugin({
        name: 'logger',
        create: () => ({
          log: (msg: string) => console.log(msg),
        }),
      });

      expect(logger.__plugin.name).toBe('logger');
      expect(logger.__config).toBeUndefined();
      expect('setup' in logger).toBe(false);
    });

    it('should create a plugin with setup', () => {
      const mem0 = definePlugin({
        name: 'mem0',
        setup: (config: { scope?: 'user' | 'brain' }) => config,
        create: ({ config }) => ({
          search: async (query: string) => [],
          add: async (messages: any[]) => {},
        }),
      });

      expect(mem0.__plugin.name).toBe('mem0');
      expect(mem0.__config).toBeUndefined();
      expect(typeof mem0.setup).toBe('function');
    });

    it('should return configured plugin from setup()', () => {
      const mem0 = definePlugin({
        name: 'mem0',
        setup: (config: { scope?: 'user' | 'brain' }) => config,
        create: ({ config }) => ({
          search: async (query: string) => [],
        }),
      });

      const configured = mem0.setup({ scope: 'user' });

      expect(configured.__plugin.name).toBe('mem0');
      expect(configured.__config).toEqual({ scope: 'user' });
      // Configured instance should not have setup
      expect('setup' in configured).toBe(false);
    });
  });

  describe('withPlugin on Brain', () => {
    it('should replace plugin by name on collision', async () => {
      const createSpy = jest.fn(({ config }: any) => ({
        level: config?.level ?? 'info',
      }));

      const logger = definePlugin({
        name: 'logger',
        setup: (config: { level: string }) => config,
        create: createSpy,
      });

      const testBrain = brain('collision-test')
        .withPlugin(logger)
        .withPlugin(logger.setup({ level: 'debug' }))
        .step('Check', ({ logger: l }) => ({ level: l.level }));

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      // Only one create call — the second withPlugin replaced the first
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(finalState).toEqual({ level: 'debug' });
    });

    it('should preserve plugins through step chaining and withOptions', async () => {
      const createSpy = jest.fn(() => ({ value: 42 }));

      const plugin = definePlugin({
        name: 'test',
        create: createSpy,
      });

      const testBrain = brain('preserve-test')
        .withPlugin(plugin)
        .withOptions(z.object({ flag: z.boolean() }))
        .step('First', ({ state }) => ({ count: 1 }))
        .step('Second', ({ state, test }) => ({
          ...state,
          value: test.value,
        }));

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
        options: { flag: true },
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(finalState).toEqual({ count: 1, value: 42 });
    });
  });

  describe('brain() config with plugins', () => {
    it('should inject multiple plugins via config object', async () => {
      const logger = definePlugin({
        name: 'logger',
        create: () => ({ log: (msg: string) => msg }),
      });
      const tracker = definePlugin({
        name: 'tracker',
        create: () => ({ track: (event: string) => event }),
      });

      const testBrain = brain({
        title: 'multi-plugin',
        plugins: { logger, tracker },
      }).step('Use Both', ({ logger: l, tracker: t }) => ({
        logged: l.log('hello'),
        tracked: t.track('step'),
      }));

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      expect(finalState).toEqual({ logged: 'hello', tracked: 'step' });
    });
  });

  describe('type inference', () => {
    it('should infer plugin injection type on StepContext', () => {
      const logger = definePlugin({
        name: 'logger',
        create: () => ({
          log: (msg: string) => {},
          level: 'info' as const,
        }),
      });

      // This test verifies at compile time that the types work.
      // If this compiles, the type inference is correct.
      brain('type-test')
        .withPlugin(logger)
        .step('Use Plugin', ({ logger: l }) => {
          // l should be PluginInjection of the create return
          l.log('hello');
          const level: 'info' = l.level;
          return { logged: true };
        });
    });

    it('should infer tools type on plugin injection', () => {
      const mem0 = definePlugin({
        name: 'mem0',
        create: () => ({
          search: async (query: string) => [] as string[],
          tools: {
            remember: {
              description: 'Remember a fact',
              inputSchema: z.object({ fact: z.string() }),
              execute: async (input: { fact: string }) => ({ ok: true }),
            },
          },
        }),
      });

      brain('tools-type-test')
        .withPlugin(mem0)
        .step('Use Plugin', ({ mem0: m }) => {
          // m.tools should be available
          const tools = m.tools;
          return { hasTools: !!tools };
        });
    });

    it('should intersect multiple plugin types via config', () => {
      const logger = definePlugin({
        name: 'logger',
        create: () => ({ log: (msg: string) => {} }),
      });
      const tracker = definePlugin({
        name: 'tracker',
        create: () => ({ track: (event: string) => {} }),
      });

      brain({ title: 'multi-type-test', plugins: { logger, tracker } }).step(
        'Both',
        ({ logger: l, tracker: t }) => {
          l.log('hello');
          t.track('step');
          return { ok: true };
        }
      );
    });
  });

  describe('runtime integration', () => {
    it('should inject plugin service methods onto StepContext', async () => {
      const searchMock = jest.fn(async (query: string) => ['result1']);
      const plugin = definePlugin({
        name: 'search',
        create: () => ({
          find: searchMock,
        }),
      });

      const testBrain = brain('inject-test')
        .withPlugin(plugin)
        .step('Use Search', async ({ search }) => {
          const results = await search.find('query');
          return { results };
        });

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      expect(searchMock).toHaveBeenCalledWith('query');
      expect(finalState).toEqual({ results: ['result1'] });
    });

    it('should pass config to plugin create', async () => {
      const createSpy = jest.fn(({ config }: any) => ({
        scope: config?.scope ?? 'default',
      }));

      const plugin = definePlugin({
        name: 'scoped',
        setup: (config: { scope: string }) => config,
        create: createSpy,
      });

      const testBrain = brain('config-test')
        .withPlugin(plugin.setup({ scope: 'user' }))
        .step('Check', ({ scoped }) => ({
          scope: scoped.scope,
        }));

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { scope: 'user' },
          brainTitle: 'config-test',
          currentUser: { name: 'test-user' },
        })
      );
      expect(finalState).toEqual({ scope: 'user' });
    });

    it('should make plugin tools accessible on context', async () => {
      const executeMock = jest.fn(async (input: { input: string }) => ({
        ok: true,
      }));

      const plugin = definePlugin({
        name: 'myPlugin',
        create: () => ({
          tools: {
            doSomething: {
              description: 'does something',
              inputSchema: z.object({ input: z.string() }),
              execute: executeMock,
            },
          },
        }),
      });

      const testBrain = brain('tools-runtime-test')
        .withPlugin(plugin)
        .step('Use Tools', async ({ myPlugin }) => {
          const result = await myPlugin.tools.doSomething.execute({
            input: 'hi',
          });
          return { result };
        });

      const { finalState } = await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      expect(executeMock).toHaveBeenCalledWith({ input: 'hi' });
      expect(finalState).toEqual({ result: { ok: true } });
    });

    it('should dispatch events to plugin adapter', async () => {
      const dispatchMock = jest.fn<(event: any) => void>();

      const plugin = definePlugin({
        name: 'eventLogger',
        create: () => ({
          adapter: {
            dispatch: dispatchMock,
          },
        }),
      });

      const testBrain = brain('adapter-test')
        .withPlugin(plugin)
        .step('Do Something', () => ({ done: true }));

      await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      // Adapter should have received events
      expect(dispatchMock.mock.calls.length).toBeGreaterThan(0);

      // Should receive START, STEP_STATUS, STEP_START, STEP_COMPLETE, STEP_STATUS, COMPLETE
      const eventTypes = dispatchMock.mock.calls.map(
        (call: any[]) => call[0].type
      );
      expect(eventTypes).toContain(BRAIN_EVENTS.START);
      expect(eventTypes).toContain(BRAIN_EVENTS.COMPLETE);
      expect(eventTypes).toContain(BRAIN_EVENTS.STEP_COMPLETE);
    });

    it('should not expose adapter on StepContext', async () => {
      let contextKeys: string[] = [];

      const plugin = definePlugin({
        name: 'withAdapter',
        create: () => ({
          doStuff: () => 'done',
          adapter: {
            dispatch: () => {},
          },
        }),
      });

      const testBrain = brain('no-adapter-ctx-test')
        .withPlugin(plugin)
        .step('Check Context', ({ withAdapter }) => {
          contextKeys = Object.keys(withAdapter);
          return { checked: true };
        });

      await runWithStateMachine(testBrain, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      expect(contextKeys).toContain('doStuff');
      expect(contextKeys).not.toContain('adapter');
    });

    it('should propagate plugins to nested brains', async () => {
      const createSpy = jest.fn(() => ({
        value: 42,
      }));

      const plugin = definePlugin({
        name: 'shared',
        create: createSpy,
      });

      const inner = brain('inner-plugin')
        .withPlugin(plugin)
        .step('Inner Step', ({ shared }) => ({
          innerValue: shared.value,
        }));

      const outer = brain('outer-plugin')
        .withPlugin(plugin)
        .brain('Run Inner', inner);

      const { finalState } = await runWithStateMachine(outer, {
        client: mockClient,
        currentUser: { name: 'test-user' },
      });

      // Plugin create should be called twice: once for outer, once for inner
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(finalState).toEqual({ innerValue: 42 });
    });
  });
});
