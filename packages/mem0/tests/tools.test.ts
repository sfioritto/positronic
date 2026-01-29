import { jest } from '@jest/globals';
import { rememberFact, recallMemories, createMem0Tools } from '../src/tools.js';
import type { StepContext, ScopedMemory, Memory } from '@positronic/core';

// Create a mock context for testing
const createMockContext = (memory?: ScopedMemory): StepContext => ({
  state: {},
  options: {},
  client: {} as any,
  resources: {} as any,
  response: undefined,
  page: undefined,
  pages: undefined,
  env: { origin: 'http://localhost:3000', secrets: {} },
  components: undefined,
  brainRunId: 'test-run-id',
  stepId: 'test-step-id',
  memory,
});

const createMockMemory = (): jest.Mocked<ScopedMemory> => ({
  search: jest.fn<ScopedMemory['search']>().mockResolvedValue([]),
  add: jest.fn<ScopedMemory['add']>().mockResolvedValue(undefined),
});

describe('rememberFact tool', () => {
  it('should have correct description and schema', () => {
    expect(rememberFact.description).toContain('Store a fact');
    expect(rememberFact.inputSchema).toBeDefined();
  });

  it('should add fact to memory', async () => {
    const mockMemory = createMockMemory();
    const context = createMockContext(mockMemory);

    const result = await rememberFact.execute!(
      { fact: 'User prefers dark mode' },
      context
    );

    expect(mockMemory.add).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'User prefers dark mode' }],
      { userId: undefined }
    );
    expect(result).toEqual({
      remembered: true,
      fact: 'User prefers dark mode',
    });
  });

  it('should pass userId when provided', async () => {
    const mockMemory = createMockMemory();
    const context = createMockContext(mockMemory);

    await rememberFact.execute!(
      { fact: 'User likes TypeScript', userId: 'user-123' },
      context
    );

    expect(mockMemory.add).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'User likes TypeScript' }],
      { userId: 'user-123' }
    );
  });

  it('should return remembered: false when memory is not configured', async () => {
    const context = createMockContext(undefined);

    const result = await rememberFact.execute!(
      { fact: 'Some fact' },
      context
    );

    expect(result).toEqual({
      remembered: false,
      fact: 'Some fact',
    });
  });
});

describe('recallMemories tool', () => {
  it('should have correct description and schema', () => {
    expect(recallMemories.description).toContain('Search long-term memory');
    expect(recallMemories.inputSchema).toBeDefined();
  });

  it('should search memories and return results', async () => {
    const mockMemory = createMockMemory();
    const testMemories: Memory[] = [
      { id: '1', content: 'User prefers dark mode', score: 0.95 },
      { id: '2', content: 'User likes TypeScript', score: 0.85 },
    ];
    mockMemory.search.mockResolvedValue(testMemories);

    const context = createMockContext(mockMemory);

    const result = await recallMemories.execute!(
      { query: 'user preferences', limit: 10 },
      context
    );

    expect(mockMemory.search).toHaveBeenCalledWith('user preferences', {
      userId: undefined,
      limit: 10,
    });
    expect(result).toEqual({
      found: 2,
      memories: [
        { content: 'User prefers dark mode', relevance: 0.95 },
        { content: 'User likes TypeScript', relevance: 0.85 },
      ],
    });
  });

  it('should pass userId and limit when provided', async () => {
    const mockMemory = createMockMemory();
    mockMemory.search.mockResolvedValue([]);
    const context = createMockContext(mockMemory);

    await recallMemories.execute!(
      { query: 'preferences', userId: 'user-123', limit: 5 },
      context
    );

    expect(mockMemory.search).toHaveBeenCalledWith('preferences', {
      userId: 'user-123',
      limit: 5,
    });
  });

  it('should return empty results when memory is not configured', async () => {
    const context = createMockContext(undefined);

    const result = await recallMemories.execute!(
      { query: 'anything', limit: 10 },
      context
    );

    expect(result).toEqual({
      found: 0,
      memories: [],
    });
  });
});

describe('createMem0Tools', () => {
  it('should return both tools', () => {
    const tools = createMem0Tools();

    expect(tools.rememberFact).toBe(rememberFact);
    expect(tools.recallMemories).toBe(recallMemories);
  });
});
