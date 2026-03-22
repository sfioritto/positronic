import { jest } from '@jest/globals';
import { brain, BrainRunner, type ObjectGenerator } from '@positronic/core';
import { createMem0Adapter } from '../src/adapter.js';
import { createMem0Tools, rememberFact, recallMemories } from '../src/tools.js';
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
