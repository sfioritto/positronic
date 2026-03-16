import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';
import {
  estimateTokens,
  estimateRequestTokens,
} from '../src/token-estimator.js';

describe('token-estimator', () => {
  describe('estimateTokens', () => {
    it('returns a positive number for non-empty text', () => {
      const count = estimateTokens('hello world');
      expect(count).toBeGreaterThan(0);
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('returns more tokens for longer text', () => {
      const short = estimateTokens('hello');
      const long = estimateTokens(
        'hello world, this is a longer sentence with many more words'
      );
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('estimateRequestTokens', () => {
    it('estimates tokens from a prompt', () => {
      const count = estimateRequestTokens({ prompt: 'Summarize this article' });
      expect(count).toBeGreaterThan(0);
    });

    it('combines system, messages, and prompt', () => {
      const promptOnly = estimateRequestTokens({ prompt: 'hello' });
      const withSystem = estimateRequestTokens({
        system: 'You are a helpful assistant',
        prompt: 'hello',
      });
      expect(withSystem).toBeGreaterThan(promptOnly);
    });

    it('handles messages array', () => {
      const count = estimateRequestTokens({
        messages: [
          { content: 'What is AI?' },
          { content: 'AI stands for artificial intelligence.' },
        ],
      });
      expect(count).toBeGreaterThan(0);
    });

    it('includes tool definitions in token count', () => {
      const withoutTools = estimateRequestTokens({
        prompt: 'hello',
      });
      const withTools = estimateRequestTokens({
        prompt: 'hello',
        tools: {
          get_weather: {
            description: 'Get the current weather for a location',
            inputSchema: z.object({
              city: z.string().describe('The city name'),
              unit: z.enum(['celsius', 'fahrenheit']).optional(),
            }),
          },
          search: {
            description: 'Search for information on the web',
            inputSchema: z.object({
              query: z.string().describe('The search query'),
              maxResults: z.number().optional(),
            }),
          },
        },
      });
      expect(withTools).toBeGreaterThan(withoutTools);
    });

    it('includes output schema in token count', () => {
      const withoutSchema = estimateRequestTokens({
        prompt: 'hello',
      });
      const withSchema = estimateRequestTokens({
        prompt: 'hello',
        schema: z.object({
          summary: z.string(),
          sentiment: z.enum(['positive', 'negative', 'neutral']),
          keywords: z.array(z.string()),
        }),
      });
      expect(withSchema).toBeGreaterThan(withoutSchema);
    });

    it('includes toolCalls from messages in token count', () => {
      const withoutToolCalls = estimateRequestTokens({
        messages: [{ content: 'What is the weather?' }],
      });
      const withToolCalls = estimateRequestTokens({
        messages: [
          { content: 'What is the weather?' },
          {
            content: '',
            toolCalls: [
              {
                toolCallId: 'call_abc123',
                toolName: 'get_weather',
                args: { city: 'San Francisco', unit: 'celsius' },
              },
            ],
          },
          {
            content: '72 degrees and sunny',
            toolCallId: 'call_abc123',
            toolName: 'get_weather',
          },
        ],
      });
      expect(withToolCalls).toBeGreaterThan(withoutToolCalls);
    });

    it('works without tools or schema (backward compatibility)', () => {
      const count = estimateRequestTokens({
        system: 'You are helpful',
        prompt: 'hello',
        messages: [{ content: 'Hi there' }],
      });
      expect(count).toBeGreaterThan(0);
    });
  });
});
