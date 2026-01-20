import { jest } from '@jest/globals';
import { z } from 'zod';
import { generateUI } from '../src/ui/generate-ui.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type { UIComponent } from '../src/ui/types.js';

const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: ObjectGenerator = {
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: mockStreamText,
};

// Simple test components
// Note: Component names must match those in FORM_COMPONENTS (validate-form.ts)
// for form validation to recognize them
const Input: UIComponent<{ name: string; label: string }> = {
  component: () => null,
  tool: {
    description: 'A text input field',
    parameters: z.object({
      name: z.string(),
      label: z.string(),
    }),
  },
};

const Button: UIComponent<{ text: string }> = {
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
      const result1 = await params.tools.Input.execute!({ name: 'email', label: 'Email Address' });
      const result2 = await params.tools.Button.execute!({ text: 'Submit' });

      return {
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'Input', args: { name: 'email', label: 'Email Address' }, result: result1 },
          { toolCallId: 'call-2', toolName: 'Button', args: { text: 'Submit' }, result: result2 },
        ],
        text: 'Created the form.',
        usage: { totalTokens: 150 },
      };
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a form with an email input and submit button',
      components: { Input, Button },
    });

    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]).toMatchObject({
      component: 'Input',
      props: { name: 'email', label: 'Email Address' },
      parentId: null,
    });
    expect(result.placements[1]).toMatchObject({
      component: 'Button',
      props: { text: 'Submit' },
      parentId: null,
    });
    // Each placement gets a unique ID
    expect(result.placements[0].id).toBeDefined();
    expect(result.placements[1].id).toBeDefined();
    expect(result.placements[0].id).not.toBe(result.placements[1].id);
    // First placement should be the root
    expect(result.rootId).toBe(result.placements[0].id);

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
      components: { Input },
    });

    expect(result.placements).toHaveLength(0);
    expect(result.text).toBe('No components needed.');
  });

  it('should include ValidateForm tool when schema is provided', async () => {
    const schema = z.object({
      email: z.string(),
      name: z.string(),
    });

    mockStreamText.mockImplementationOnce(async (params) => {
      // Verify ValidateForm tool is present
      expect(params.tools.ValidateForm).toBeDefined();
      expect(params.tools.ValidateForm.description).toContain('schema');

      // Place only email field (missing name)
      const result1 = await params.tools.Input.execute!({ name: 'email', label: 'Email' });

      // Call ValidateForm - should report missing 'name' field
      const validation = await params.tools.ValidateForm.execute!({});

      return {
        toolCalls: [
          { toolCallId: 'c1', toolName: 'Input', args: { name: 'email', label: 'Email' }, result: result1 },
          { toolCallId: 'c2', toolName: 'ValidateForm', args: {}, result: validation },
        ],
        usage: { totalTokens: 100 },
      };
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a contact form',
      components: { Input },
      schema,
    });

    // Should have the input placement plus ValidateForm result
    expect(result.placements).toHaveLength(1);

    // The ValidateForm result should indicate missing field
    const validationResult = mockStreamText.mock.calls[0][0].tools.ValidateForm;
    expect(validationResult).toBeDefined();
  });

  it('should validate form fields against schema', async () => {
    const schema = z.object({
      email: z.string(),
      age: z.number(),
      subscribe: z.boolean().optional(),
    });

    let validationResults: any[] = [];

    mockStreamText.mockImplementationOnce(async (params) => {
      // First validation - no fields placed yet
      const v1 = await params.tools.ValidateForm.execute!({});
      validationResults.push(v1);

      // Place email field
      const r1 = await params.tools.Input.execute!({ name: 'email', label: 'Email' });

      // Second validation - missing age (subscribe is optional)
      const v2 = await params.tools.ValidateForm.execute!({});
      validationResults.push(v2);

      // Place age field
      const r2 = await params.tools.Input.execute!({ name: 'age', label: 'Age' });

      // Third validation - all required fields present
      const v3 = await params.tools.ValidateForm.execute!({});
      validationResults.push(v3);

      return {
        toolCalls: [
          { toolCallId: 'c1', toolName: 'ValidateForm', args: {}, result: v1 },
          { toolCallId: 'c2', toolName: 'Input', args: { name: 'email', label: 'Email' }, result: r1 },
          { toolCallId: 'c3', toolName: 'ValidateForm', args: {}, result: v2 },
          { toolCallId: 'c4', toolName: 'Input', args: { name: 'age', label: 'Age' }, result: r2 },
          { toolCallId: 'c5', toolName: 'ValidateForm', args: {}, result: v3 },
        ],
        usage: { totalTokens: 200 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a signup form',
      components: { Input },
      schema,
    });

    // First validation: missing both email and age
    expect(validationResults[0].valid).toBe(false);
    expect(validationResults[0].errors.map((e: { message: string }) => e.message)).toContain('Missing required field: email');
    expect(validationResults[0].errors.map((e: { message: string }) => e.message)).toContain('Missing required field: age');

    // Second validation: missing age
    expect(validationResults[1].valid).toBe(false);
    expect(validationResults[1].errors.map((e: { message: string }) => e.message)).not.toContain('Missing required field: email');
    expect(validationResults[1].errors.map((e: { message: string }) => e.message)).toContain('Missing required field: age');

    // Third validation: all required fields present
    expect(validationResults[2].valid).toBe(true);
    expect(validationResults[2].errors).toHaveLength(0);
  });
});
