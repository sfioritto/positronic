import { jest } from '@jest/globals';
import { brain, BRAIN_EVENTS, type ObjectGenerator } from '@positronic/core';
import { mem0 } from '../src/plugin.js';
import type { Mem0PluginConfig } from '../src/plugin.js';
import { createMockProvider, collectEvents } from './test-helpers.js';

const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

describe('Mem0 API calls', () => {
  const mockFetch = jest.fn<typeof global.fetch>();
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as typeof global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  let brainCounter = 0;
  async function runWithMem0(
    config: Mem0PluginConfig,
    action: (m: any) => Promise<any>
  ) {
    const testBrain = brain(`mem0-api-test-${++brainCounter}`)
      .withPlugin(mem0.setup(config))
      .step('Action', async ({ mem0: m }) => {
        await action(m);
        return { done: true };
      });
    await collectEvents(
      testBrain.run({ client: mockClient, currentUser: { name: 'alice' } })
    );
  }

  it('search uses composite user_id filter', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await runWithMem0({ apiKey: 'test-key' }, (m) =>
      m.search('test query', { limit: 5 })
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.mem0.ai/v2/memories/search/');
    const body = JSON.parse(init!.body as string);
    expect(body.filters.user_id).toContain('alice/');
    expect(body.top_k).toBe(5);
  });

  it('add uses composite user_id', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
    );

    await runWithMem0({ apiKey: 'test-key' }, (m) =>
      m.add([{ role: 'user', content: 'I like Rust' }])
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.mem0.ai/v1/memories/');
    const body = JSON.parse(init!.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'I like Rust' }]);
    expect(body.user_id).toContain('alice/');
    expect(body).not.toHaveProperty('agent_id');
  });

  it('sends correct auth headers', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 })
    );

    await runWithMem0({ apiKey: 'my-secret-key' }, (m) =>
      m.add([{ role: 'user', content: 'test' }])
    );

    const headers = mockFetch.mock.calls[0][1]!.headers as Record<
      string,
      string
    >;
    expect(headers['Authorization']).toBe('Token my-secret-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('parses v2 search response format { memories: [...] }', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          memories: [
            { id: 'm1', memory: 'User likes Rust', score: 0.95 },
            { id: 'm2', memory: 'User prefers dark mode', score: 0.8 },
          ],
        }),
        { status: 200 }
      )
    );

    let results: any[] = [];
    await runWithMem0({ apiKey: 'test-key' }, async (m) => {
      results = await m.search('preferences');
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
        metadata: undefined,
      },
    ]);
  });

  it('parses bare array search response', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify([{ id: 'm1', memory: 'User likes hiking', score: 0.9 }]),
        { status: 200 }
      )
    );

    let results: any[] = [];
    await runWithMem0({ apiKey: 'test-key' }, async (m) => {
      results = await m.search('hobbies');
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('User likes hiking');
  });

  it('throws on search failure', async () => {
    mockFetch.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    await expect(
      runWithMem0({ apiKey: 'test-key' }, (m) => m.search('test'))
    ).rejects.toThrow('Mem0 search failed (500)');
  });

  it('throws on add failure', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(
      runWithMem0({ apiKey: 'bad-key' }, (m) =>
        m.add([{ role: 'user', content: 'test' }])
      )
    ).rejects.toThrow('Mem0 add failed (401)');
  });
});

describe('Mem0 Plugin', () => {
  it('should scope memory to brain + user', async () => {
    const provider = createMockProvider();
    provider.seedMemories([
      { id: '1', content: 'User likes dark mode', score: 0.95 },
    ]);

    const testBrain = brain('plugin-scope-test')
      .withPlugin(mem0.setup({ provider }))
      .step('Search and add', async ({ mem0: m }) => {
        const results = await m.search('preferences');
        await m.add([{ role: 'user', content: 'test' }]);
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
      agentId: 'plugin-scope-test',
      userId: 'alice',
    });

    const addCalls = provider.getAddCalls();
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].scope).toEqual({
      agentId: 'plugin-scope-test',
      userId: 'alice',
    });

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
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
});
