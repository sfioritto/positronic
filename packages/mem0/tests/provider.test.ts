import { jest } from '@jest/globals';
import { createMem0Provider } from '../src/provider.js';
import type { MemoryMessage } from '@positronic/core';

// Mock fetch globally
const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch;

describe('createMem0Provider', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('search', () => {
    it('should call Mem0 API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: '1', memory: 'User likes dark mode', score: 0.95 },
            { id: '2', memory: 'User prefers TypeScript', score: 0.85 },
          ],
        }),
      } as Response);

      const provider = createMem0Provider({ apiKey: 'test-key' });
      const results = await provider.search(
        'user preferences',
        { agentId: 'my-brain', userId: 'user-123' },
        { limit: 10 }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mem0.ai/v1/memories/search/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test-key',
          },
          body: JSON.stringify({
            query: 'user preferences',
            agent_id: 'my-brain',
            user_id: 'user-123',
            limit: 10,
          }),
        }
      );

      expect(results).toEqual([
        { id: '1', content: 'User likes dark mode', score: 0.95, metadata: undefined },
        { id: '2', content: 'User prefers TypeScript', score: 0.85, metadata: undefined },
      ]);
    });

    it('should use custom base URL when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response);

      const provider = createMem0Provider({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      await provider.search('test', { agentId: 'brain' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/memories/search/',
        expect.any(Object)
      );
    });

    it('should include org and project headers when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response);

      const provider = createMem0Provider({
        apiKey: 'test-key',
        orgId: 'my-org',
        projectId: 'my-project',
      });
      await provider.search('test', { agentId: 'brain' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Mem0-Org-Id': 'my-org',
            'Mem0-Project-Id': 'my-project',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      const provider = createMem0Provider({ apiKey: 'invalid-key' });

      await expect(
        provider.search('test', { agentId: 'brain' })
      ).rejects.toThrow('Mem0 search failed (401): Unauthorized');
    });
  });

  describe('add', () => {
    it('should call Mem0 API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: '1', memory: 'User likes dark mode', event: 'add' }],
        }),
      } as Response);

      const provider = createMem0Provider({ apiKey: 'test-key' });
      const messages: MemoryMessage[] = [
        { role: 'user', content: 'I prefer dark mode' },
        { role: 'assistant', content: "Got it, you prefer dark mode" },
      ];

      await provider.add(
        messages,
        { agentId: 'my-brain', userId: 'user-123' },
        { metadata: { source: 'chat' } }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mem0.ai/v1/memories/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test-key',
          },
          body: JSON.stringify({
            messages: [
              { role: 'user', content: 'I prefer dark mode' },
              { role: 'assistant', content: "Got it, you prefer dark mode" },
            ],
            agent_id: 'my-brain',
            user_id: 'user-123',
            metadata: { source: 'chat' },
          }),
        }
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const provider = createMem0Provider({ apiKey: 'test-key' });

      await expect(
        provider.add(
          [{ role: 'user', content: 'test' }],
          { agentId: 'brain' }
        )
      ).rejects.toThrow('Mem0 add failed (500): Internal Server Error');
    });
  });
});
