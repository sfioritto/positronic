import { jest } from '@jest/globals';
import { z } from 'zod';
import { generateUI } from '../src/ui/generate-ui.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type { UIComponent } from '../src/ui/types.js';

const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: ObjectGenerator = {
  generateObject: jest.fn(),
  streamText: mockStreamText,
};

// Simple test components
const TestInput: UIComponent<{ name: string; label: string }> = {
  component: () => null,
  tool: {
    description: 'A text input field',
    parameters: z.object({
      name: z.string(),
      label: z.string(),
    }),
  },
};

const TestButton: UIComponent<{ text: string }> = {
  component: () => null,
  tool: {
    description: 'A button',
    parameters: z.object({
      text: z.string(),
    }),
  },
};

describe('generateUI', () => {
  beforeEach(() => {
    mockStreamText.mockClear();
  });

  it('should return placements for each component tool call', async () => {
    // Mock simulates a real client by calling the execute functions
    mockStreamText.mockImplementationOnce(async (params) => {
      const result1 = await params.tools.TestInput.execute!({ name: 'email', label: 'Email Address' });
      const result2 = await params.tools.TestButton.execute!({ text: 'Submit' });

      return {
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'TestInput', args: { name: 'email', label: 'Email Address' }, result: result1 },
          { toolCallId: 'call-2', toolName: 'TestButton', args: { text: 'Submit' }, result: result2 },
        ],
        text: 'Created the form.',
        usage: { totalTokens: 150 },
      };
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a form with an email input and submit button',
      components: { TestInput, TestButton },
    });

    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]).toMatchObject({
      component: 'TestInput',
      props: { name: 'email', label: 'Email Address' },
    });
    expect(result.placements[1]).toMatchObject({
      component: 'TestButton',
      props: { text: 'Submit' },
    });
    // Each placement gets a unique ID
    expect(result.placements[0].id).toBeDefined();
    expect(result.placements[1].id).toBeDefined();
    expect(result.placements[0].id).not.toBe(result.placements[1].id);

    expect(result.text).toBe('Created the form.');
    expect(result.usage.totalTokens).toBe(150);
  });

  it('should return empty placements when no tools are called', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: 'No components needed.',
      usage: { totalTokens: 30 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Show a blank page',
      components: { TestInput },
    });

    expect(result.placements).toHaveLength(0);
    expect(result.text).toBe('No components needed.');
  });
});
