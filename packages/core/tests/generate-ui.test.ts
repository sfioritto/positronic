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

  it('should convert components to tools and call streamText', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'TestInput',
          args: { name: 'email', label: 'Email Address' },
          result: { id: 'comp-1', component: 'TestInput', props: { name: 'email', label: 'Email Address' } },
        },
        {
          toolCallId: 'call-2',
          toolName: 'TestButton',
          args: { text: 'Submit' },
          result: { id: 'comp-2', component: 'TestButton', props: { text: 'Submit' } },
        },
      ],
      text: 'I created a form with an email input and submit button.',
      usage: { totalTokens: 150 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a form with an email input and submit button',
      components: { TestInput, TestButton },
    });

    // Verify streamText was called with correct tools
    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const call = mockStreamText.mock.calls[0][0];
    expect(call.prompt).toBe('Create a form with an email input and submit button');
    expect(call.tools).toHaveProperty('TestInput');
    expect(call.tools).toHaveProperty('TestButton');
    expect(call.tools.TestInput.description).toBe('A text input field');
    expect(call.tools.TestButton.description).toBe('A button');
    expect(call.maxSteps).toBe(10);

    // Verify result
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]).toMatchObject({
      component: 'TestInput',
      props: { name: 'email', label: 'Email Address' },
    });
    expect(result.placements[1]).toMatchObject({
      component: 'TestButton',
      props: { text: 'Submit' },
    });
    expect(result.text).toBe('I created a form with an email input and submit button.');
    expect(result.usage.totalTokens).toBe(150);
  });

  it('should use custom system prompt when provided', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      usage: { totalTokens: 50 },
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a dashboard',
      components: { TestInput },
      system: 'You are a dashboard builder.',
    });

    const call = mockStreamText.mock.calls[0][0];
    expect(call.system).toBe('You are a dashboard builder.');
  });

  it('should use custom maxSteps when provided', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      usage: { totalTokens: 50 },
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a form',
      components: { TestInput },
      maxSteps: 5,
    });

    const call = mockStreamText.mock.calls[0][0];
    expect(call.maxSteps).toBe(5);
  });

  it('should handle empty tool calls', async () => {
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

  it('should execute tool and return placement with unique id', async () => {
    // This test verifies that the execute function generates unique IDs
    mockStreamText.mockImplementationOnce(async (params) => {
      // Simulate calling the execute function like streamText would
      const inputTool = params.tools.TestInput;
      const result1 = await inputTool.execute!({ name: 'field1', label: 'Field 1' });
      const result2 = await inputTool.execute!({ name: 'field2', label: 'Field 2' });

      return {
        toolCalls: [
          { toolCallId: 'c1', toolName: 'TestInput', args: { name: 'field1', label: 'Field 1' }, result: result1 },
          { toolCallId: 'c2', toolName: 'TestInput', args: { name: 'field2', label: 'Field 2' }, result: result2 },
        ],
        usage: { totalTokens: 100 },
      };
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create two inputs',
      components: { TestInput },
    });

    expect(result.placements).toHaveLength(2);
    // Each placement should have a unique id
    expect(result.placements[0].id).toBeDefined();
    expect(result.placements[1].id).toBeDefined();
    expect(result.placements[0].id).not.toBe(result.placements[1].id);
    // Verify component and props
    expect(result.placements[0].component).toBe('TestInput');
    expect(result.placements[0].props).toEqual({ name: 'field1', label: 'Field 1' });
    expect(result.placements[1].component).toBe('TestInput');
    expect(result.placements[1].props).toEqual({ name: 'field2', label: 'Field 2' });
  });
});
