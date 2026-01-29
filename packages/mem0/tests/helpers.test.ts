import { jest } from '@jest/globals';
import { formatMemories, createMemorySystemPrompt, getMemoryContext } from '../src/helpers.js';
import type { Memory, ScopedMemory, MemorySearchOptions, MemoryAddOptions, MemoryMessage } from '@positronic/core';

// Create a mock ScopedMemory for testing
function createMockScopedMemory(searchResult: Memory[] = []): ScopedMemory {
  return {
    search: jest.fn(
      async (_query: string, _options?: MemorySearchOptions): Promise<Memory[]> => searchResult
    ),
    add: jest.fn(
      async (_messages: MemoryMessage[], _options?: MemoryAddOptions): Promise<void> => {}
    ),
  };
}

describe('formatMemories', () => {
  const testMemories: Memory[] = [
    { id: '1', content: 'User prefers dark mode', score: 0.95 },
    { id: '2', content: 'User likes TypeScript', score: 0.85 },
    { id: '3', content: 'User works on web apps' },
  ];

  it('should format memories as numbered list', () => {
    const result = formatMemories(testMemories);
    expect(result).toBe(
      '1. User prefers dark mode\n' +
      '2. User likes TypeScript\n' +
      '3. User works on web apps'
    );
  });

  it('should include header when provided', () => {
    const result = formatMemories(testMemories, {
      header: 'User preferences:',
    });
    expect(result).toBe(
      'User preferences:\n' +
      '1. User prefers dark mode\n' +
      '2. User likes TypeScript\n' +
      '3. User works on web apps'
    );
  });

  it('should include scores when requested', () => {
    const result = formatMemories(testMemories, { includeScores: true });
    expect(result).toBe(
      '1. User prefers dark mode (0.95)\n' +
      '2. User likes TypeScript (0.85)\n' +
      '3. User works on web apps'
    );
  });

  it('should return empty string for empty array', () => {
    const result = formatMemories([]);
    expect(result).toBe('');
  });

  it('should return emptyText when provided and array is empty', () => {
    const result = formatMemories([], { emptyText: 'No memories found' });
    expect(result).toBe('No memories found');
  });

  it('should handle undefined memories', () => {
    const result = formatMemories(undefined as unknown as Memory[]);
    expect(result).toBe('');
  });
});

describe('createMemorySystemPrompt', () => {
  it('should append memories to base prompt', async () => {
    const memories: Memory[] = [
      { id: '1', content: 'User prefers concise responses', score: 0.9 },
    ];
    const mockScopedMemory = createMockScopedMemory(memories);

    const result = await createMemorySystemPrompt(
      mockScopedMemory,
      'You are a helpful assistant.',
      'user preferences'
    );

    expect(mockScopedMemory.search).toHaveBeenCalledWith('user preferences', {
      userId: undefined,
      limit: undefined,
    });
    expect(result).toBe(
      'You are a helpful assistant.\n\n' +
      'Relevant context from previous interactions:\n' +
      '1. User prefers concise responses'
    );
  });

  it('should return base prompt when no memories found', async () => {
    const mockScopedMemory = createMockScopedMemory([]);

    const result = await createMemorySystemPrompt(
      mockScopedMemory,
      'You are a helpful assistant.',
      'user preferences'
    );

    expect(result).toBe('You are a helpful assistant.');
  });

  it('should use custom header when provided', async () => {
    const memories: Memory[] = [
      { id: '1', content: 'User likes dark mode', score: 0.95 },
    ];
    const mockScopedMemory = createMockScopedMemory(memories);

    const result = await createMemorySystemPrompt(
      mockScopedMemory,
      'Base prompt',
      'preferences',
      { memoriesHeader: '\n\nKnown facts:' }
    );

    expect(result).toBe(
      'Base prompt\n\n' +
      'Known facts:\n' +
      '1. User likes dark mode'
    );
  });

  it('should pass userId and limit to search', async () => {
    const mockScopedMemory = createMockScopedMemory([]);

    await createMemorySystemPrompt(
      mockScopedMemory,
      'Base',
      'query',
      { userId: 'user-123', limit: 5 }
    );

    expect(mockScopedMemory.search).toHaveBeenCalledWith('query', {
      userId: 'user-123',
      limit: 5,
    });
  });
});

describe('getMemoryContext', () => {
  it('should return formatted memories', async () => {
    const memories: Memory[] = [
      { id: '1', content: 'User prefers TypeScript', score: 0.9 },
      { id: '2', content: 'User works on React apps', score: 0.8 },
    ];
    const mockScopedMemory = createMockScopedMemory(memories);

    const result = await getMemoryContext(mockScopedMemory, 'user context');

    expect(result).toBe(
      '1. User prefers TypeScript\n' +
      '2. User works on React apps'
    );
  });

  it('should return empty string when no memories found', async () => {
    const mockScopedMemory = createMockScopedMemory([]);

    const result = await getMemoryContext(mockScopedMemory, 'query');

    expect(result).toBe('');
  });

  it('should pass options to search', async () => {
    const mockScopedMemory = createMockScopedMemory([]);

    await getMemoryContext(mockScopedMemory, 'query', {
      userId: 'user-123',
      limit: 3,
    });

    expect(mockScopedMemory.search).toHaveBeenCalledWith('query', {
      userId: 'user-123',
      limit: 3,
    });
  });
});
