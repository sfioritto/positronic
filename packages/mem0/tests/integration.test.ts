import { jest } from '@jest/globals';
import { brain, BrainRunner, type ObjectGenerator } from '@positronic/core';
import { createMem0Adapter } from '../src/adapter.js';
import { createMem0Tools, rememberFact, recallMemories } from '../src/tools.js';
import { createMem0Provider } from '../src/provider.js';
import { createMockProvider } from './test-helpers.js';

const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

describe('Memory Tools Integration', () => {
  describe('createMem0Tools', () => {
    it('returns both tools', () => {
      const tools = createMem0Tools();

      expect(tools.rememberFact).toBe(rememberFact);
      expect(tools.recallMemories).toBe(recallMemories);
    });
  });
});

describe('Mem0 Adapter Integration', () => {
  it('does not call add when buffer is empty', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({ provider });

    // Simple step brain that doesn't have agent steps
    const testBrain = brain('test-no-agent').step('Simple', () => ({
      done: true,
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain, { currentUser: { name: 'test-user' } });

    // No messages were generated, so nothing should be indexed
    expect(provider.getAddCalls()).toHaveLength(0);
  });
});

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
