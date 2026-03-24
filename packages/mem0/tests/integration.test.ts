import { jest } from '@jest/globals';
import { brain, BRAIN_EVENTS, type ObjectGenerator } from '@positronic/core';
import { createMem0Provider } from '../src/provider.js';
import { mem0 } from '../src/plugin.js';
import { createMockProvider, collectEvents } from './test-helpers.js';

const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

describe('Mem0 Provider Two-Tier Memory', () => {
  const mockFetch = jest.fn<typeof global.fetch>();
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as typeof global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const provider = createMem0Provider({ apiKey: 'test-key' });

  describe('search', () => {
    it('uses OR filter when userId is present (both tiers)', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      );

      await provider.search('test query', {
        agentId: 'my-brain',
        userId: 'alice',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.mem0.ai/v2/memories/search/');
      const body = JSON.parse(init!.body as string);
      expect(body.query).toBe('test query');
      expect(body.filters).toEqual({
        OR: [
          { agent_id: 'my-brain' },
          {
            AND: [
              { user_id: 'alice' },
              { metadata: { associated_agent: 'my-brain' } },
            ],
          },
        ],
      });
    });

    it('uses agent-only filter when userId is absent', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      );

      await provider.search('test query', { agentId: 'my-brain' });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.filters).toEqual({ agent_id: 'my-brain' });
    });

    it('passes top_k when limit is provided', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      );

      await provider.search(
        'test query',
        { agentId: 'my-brain', userId: 'alice' },
        { limit: 5 }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.top_k).toBe(5);
    });

    it('maps Mem0 response to Memory format', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 'm1', memory: 'User likes Rust', score: 0.95 },
            {
              id: 'm2',
              memory: 'User prefers dark mode',
              score: 0.8,
              metadata: { associated_agent: 'my-brain' },
            },
          ]),
          { status: 200 }
        )
      );

      const results = await provider.search('preferences', {
        agentId: 'my-brain',
        userId: 'alice',
      });

      expect(results).toEqual([
        {
          id: 'm1',
          content: 'User likes Rust',
          score: 0.95,
          metadata: undefined,
        },
        {
          id: 'm2',
          content: 'User prefers dark mode',
          score: 0.8,
          metadata: { associated_agent: 'my-brain' },
        },
      ]);
    });
  });

  describe('add', () => {
    it('stores as Tier 2 (user-scoped) when userId is present', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add([{ role: 'user', content: 'I like Rust' }], {
        agentId: 'my-brain',
        userId: 'alice',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.user_id).toBe('alice');
      expect(body.metadata).toEqual({ associated_agent: 'my-brain' });
      expect(body.agent_id).toBeUndefined();
      expect(body.version).toBe('v2');
    });

    it('stores as Tier 1 (agent-scoped) when userId is absent', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add(
        [{ role: 'assistant', content: 'Global agent knowledge' }],
        { agentId: 'my-brain' }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.agent_id).toBe('my-brain');
      expect(body.user_id).toBeUndefined();
      expect(body.metadata).toBeUndefined();
    });

    it('merges user metadata with associated_agent for Tier 2', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add(
        [{ role: 'user', content: 'I like Rust' }],
        { agentId: 'my-brain', userId: 'alice' },
        { metadata: { source: 'preference', importance: 'high' } }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.metadata).toEqual({
        source: 'preference',
        importance: 'high',
        associated_agent: 'my-brain',
      });
    });

    it('associated_agent overrides conflicting user metadata key', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add(
        [{ role: 'user', content: 'test' }],
        { agentId: 'my-brain', userId: 'alice' },
        { metadata: { associated_agent: 'should-be-overridden' } }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.metadata.associated_agent).toBe('my-brain');
    });

    it('passes user metadata through for Tier 1 (no userId)', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add(
        [{ role: 'assistant', content: 'knowledge' }],
        { agentId: 'my-brain' },
        { metadata: { source: 'system' } }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.agent_id).toBe('my-brain');
      expect(body.metadata).toEqual({ source: 'system' });
    });

    it('sends correct auth headers', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
      );

      await provider.add([{ role: 'user', content: 'test' }], {
        agentId: 'my-brain',
      });

      const headers = mockFetch.mock.calls[0][1]!.headers as Record<
        string,
        string
      >;
      expect(headers['Authorization']).toBe('Token test-key');
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});

describe('Mem0 Plugin', () => {
  it('should inject search and add methods onto StepContext', async () => {
    const provider = createMockProvider();
    provider.seedMemories([
      { id: '1', content: 'User likes dark mode', score: 0.95 },
    ]);

    const testBrain = brain('plugin-search-test')
      .withPlugin(mem0.setup({ provider }))
      .step('Search', async ({ mem0: m }) => {
        const results = await m.search('preferences');
        return { found: results.length };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'alice' },
      })
    );

    const searchCalls = provider.getSearchCalls();
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].scope).toEqual({
      agentId: 'plugin-search-test',
      userId: 'alice',
    });

    // Verify brain completed
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should scope memory to user when scope is "user"', async () => {
    const provider = createMockProvider();

    const testBrain = brain('user-scope-test')
      .withPlugin(mem0.setup({ provider, scope: 'user' }))
      .step('Add', async ({ mem0: m }) => {
        await m.add([{ role: 'user', content: 'test' }]);
        return { added: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'alice' },
      })
    );

    const addCalls = provider.getAddCalls();
    expect(addCalls).toHaveLength(1);
    // scope: 'user' -> agentId is empty, userId is present
    expect(addCalls[0].scope).toEqual({ agentId: '', userId: 'alice' });
  });

  it('should scope memory to brain when scope is "brain"', async () => {
    const provider = createMockProvider();

    const testBrain = brain('brain-scope-test')
      .withPlugin(mem0.setup({ provider, scope: 'brain' }))
      .step('Add', async ({ mem0: m }) => {
        await m.add([{ role: 'user', content: 'test' }]);
        return { added: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'alice' },
      })
    );

    const addCalls = provider.getAddCalls();
    expect(addCalls).toHaveLength(1);
    // scope: 'brain' -> agentId is present, userId is empty
    expect(addCalls[0].scope).toEqual({
      agentId: 'brain-scope-test',
      userId: '',
    });
  });

  it('should expose tools that close over scoped memory', async () => {
    const provider = createMockProvider();

    const testBrain = brain('plugin-tools-test')
      .withPlugin(mem0.setup({ provider }))
      .step('Remember', async ({ mem0: m }) => {
        const result = await m.tools.rememberFact.execute({
          fact: 'User likes TypeScript',
        });
        return { result };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'alice' },
      })
    );

    const addCalls = provider.getAddCalls();
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].messages).toEqual([
      { role: 'assistant', content: 'User likes TypeScript' },
    ]);
    expect(addCalls[0].scope).toEqual({
      agentId: 'plugin-tools-test',
      userId: 'alice',
    });
  });

  it('should dispatch events to plugin adapter', async () => {
    const provider = createMockProvider();

    const testBrain = brain('plugin-adapter-test')
      .withPlugin(mem0.setup({ provider }))
      .step('Do', () => ({ done: true }));

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'alice' },
      })
    );

    // Adapter should have received COMPLETE event
    // (but buffer is empty, so no add calls expected)
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(provider.getAddCalls()).toHaveLength(0);
  });
});
