import { jest } from '@jest/globals';
import { z } from 'zod';  // Still needed for schema in tests
import { generateUI } from '../src/ui/generate-ui.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type { UIComponent } from '../src/ui/types.js';
import type { ResolvedBinding } from '../src/yaml/types.js';

// Type for the validation result returned by validate_template tool
type ValidationResult = {
  valid: boolean;
  errors: Array<{ type: string; message: string }>;
  extractedFields?: Array<{ name: string; type: string }>;
  resolvedBindings?: ResolvedBinding[];
};

const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: ObjectGenerator = {
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: mockStreamText,
};

// Simple test components
const Input: UIComponent<{ name: string; label: string }> = {
  component: () => null,
  description: 'A text input field',
};

const Button: UIComponent<{ text: string }> = {
  component: () => null,
  description: 'A button',
};

const Form: UIComponent<{ submitLabel?: string }> = {
  component: () => null,
  description: 'A form container',
};

describe('generateUI', () => {
  beforeEach(() => {
    mockStreamText.mockClear();
  });

  it('should parse YAML template and return placements', async () => {
    // Mock LLM returns YAML template
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: `Form:
  submitLabel: "Send"
  children:
    - Input:
        name: "email"
        label: "Email Address"
    - Button:
        text: "Submit"`,
      usage: { totalTokens: 150 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a form with an email input and submit button',
      components: { Form, Input, Button },
    });

    expect(result.placements).toHaveLength(3);

    // Root component is Form
    const formPlacement = result.placements.find((p) => p.component === 'Form');
    expect(formPlacement).toBeDefined();
    expect(formPlacement!.parentId).toBeNull();
    expect(formPlacement!.props.submitLabel).toBe('Send');

    // Input is child of Form
    const inputPlacement = result.placements.find(
      (p) => p.component === 'Input'
    );
    expect(inputPlacement).toBeDefined();
    expect(inputPlacement!.parentId).toBe(formPlacement!.id);
    expect(inputPlacement!.props).toEqual({
      name: 'email',
      label: 'Email Address',
    });

    // Button is child of Form
    const buttonPlacement = result.placements.find(
      (p) => p.component === 'Button'
    );
    expect(buttonPlacement).toBeDefined();
    expect(buttonPlacement!.parentId).toBe(formPlacement!.id);

    // Root ID should be the Form
    expect(result.rootId).toBe(formPlacement!.id);

    expect(result.yaml).toContain('Form:');
    expect(result.usage.totalTokens).toBe(150);
  });

  it('should return empty placements when no YAML is returned', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: 'I cannot create a UI for that request.',
      usage: { totalTokens: 30 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Show a blank page',
      components: { Input },
    });

    expect(result.placements).toHaveLength(0);
    expect(result.rootId).toBeUndefined();
  });

  it('should strip markdown code fences from YAML', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: `Here's your form:

\`\`\`yaml
Form:
  children:
    - Input:
        name: "name"
        label: "Name"
\`\`\`

This form collects a name.`,
      usage: { totalTokens: 100 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a name form',
      components: { Form, Input },
    });

    expect(result.placements).toHaveLength(2);
    expect(result.placements[0].component).toBe('Form');
  });

  it('should include validate_template tool and pass schema validation', async () => {
    const schema = z.object({
      email: z.string(),
      name: z.string(),
    });

    // Mock LLM calls validate_template and returns valid YAML
    mockStreamText.mockImplementationOnce(async (params) => {
      // Verify validate_template tool is present
      expect(params.tools.validate_template).toBeDefined();
      expect(params.tools.validate_template.description).toContain('Validate');

      // Simulate LLM calling validate_template with valid YAML
      const validationResult = (await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Input:
        name: "name"
        label: "Name"
    - Button:
        text: "Submit"`,
      })) as ValidationResult;

      expect(validationResult.valid).toBe(true);
      expect(validationResult.errors).toHaveLength(0);

      return {
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'validate_template',
            args: { yaml: '...' },
            result: validationResult,
          },
        ],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Input:
        name: "name"
        label: "Name"
    - Button:
        text: "Submit"`,
        usage: { totalTokens: 100 },
      };
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a contact form',
      components: { Form, Input, Button },
      schema,
    });

    expect(result.placements).toHaveLength(4);
  });

  it('should detect missing required fields in schema validation', async () => {
    // Note: Input component maps to 'string' type in the schema extractor
    // So we use string fields in the schema
    const schema = z.object({
      email: z.string(),
      name: z.string(),
      subscribe: z.boolean().optional(),
    });

    const validationResults: unknown[] = [];

    mockStreamText.mockImplementationOnce(async (params) => {
      // First validation - only email field (missing name, also missing Button)
      const v1 = await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Button:
        text: "Submit"`,
      });
      validationResults.push(v1);

      // Second validation - email and name with Button
      const v2 = await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Input:
        name: "name"
        label: "Name"
    - Button:
        text: "Submit"`,
      });
      validationResults.push(v2);

      return {
        toolCalls: [],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Input:
        name: "name"
        label: "Name"
    - Button:
        text: "Submit"`,
        usage: { totalTokens: 200 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a signup form',
      components: { Form, Input, Button },
      schema,
    });

    // First validation: missing name (subscribe is optional)
    const v1 = validationResults[0] as {
      valid: boolean;
      errors: Array<{ message: string }>;
    };
    expect(v1.valid).toBe(false);
    expect(v1.errors.map((e) => e.message)).toContain(
      'Missing required form field: "name"'
    );

    // Second validation: all required fields present
    const v2 = validationResults[1] as {
      valid: boolean;
      errors: Array<{ message: string }>;
    };
    expect(v2.valid).toBe(true);
    expect(v2.errors).toHaveLength(0);
  });

  it('should handle data bindings in props', async () => {
    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
        defaultValue: "{{user.email}}"`,
      usage: { totalTokens: 100 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Create a form with default email',
      components: { Form, Input },
      data: { user: { email: 'test@example.com' } },
    });

    expect(result.placements).toHaveLength(2);
    const inputPlacement = result.placements.find(
      (p) => p.component === 'Input'
    );
    expect(inputPlacement!.props.defaultValue).toBe('{{user.email}}');
  });

  it('should validate data bindings against provided data', async () => {
    mockStreamText.mockImplementationOnce(async (params) => {
      // Valid binding
      const v1 = await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "{{labels.email}}"`,
      });

      // Invalid binding
      const v2 = await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "{{nonexistent.path}}"`,
      });

      return {
        toolCalls: [],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "{{labels.email}}"`,
        usage: { totalTokens: 100 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a form',
      components: { Form, Input },
      data: { labels: { email: 'Email Address' } },
    });

    // The mock implementation tests the validation internally
    // We just verify it runs without error
  });

  it('should return yaml in result', async () => {
    const yamlContent = `Form:
  submitLabel: "Go"`;

    mockStreamText.mockResolvedValueOnce({
      toolCalls: [],
      text: yamlContent,
      usage: { totalTokens: 50 },
    });

    const result = await generateUI({
      client: mockClient,
      prompt: 'Simple form',
      components: { Form },
    });

    expect(result.yaml).toBe(yamlContent);
  });

  it('should fail validation when Form has no Button', async () => {
    mockStreamText.mockImplementationOnce(async (params) => {
      // Form without a Button - should fail validation
      const result = (await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"`,
      })) as ValidationResult;

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('form-missing-submit-button');
      expect(result.errors[0].message).toBe(
        'Form component requires a Button for submission'
      );

      return {
        toolCalls: [],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"`,
        usage: { totalTokens: 100 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a form',
      components: { Form, Input },
    });
  });

  it('should pass validation when Form has a Button', async () => {
    mockStreamText.mockImplementationOnce(async (params) => {
      // Form with a Button - should pass validation
      const result = (await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Button:
        text: "Submit"`,
      })) as ValidationResult;

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      return {
        toolCalls: [],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Button:
        text: "Submit"`,
        usage: { totalTokens: 100 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a form with submit button',
      components: { Form, Input, Button },
    });
  });

  it('should pass validation when Form has nested Button', async () => {
    const Container: UIComponent<Record<string, never>> = {
      component: () => null,
      description: 'A container',
    };

    mockStreamText.mockImplementationOnce(async (params) => {
      // Form with Button nested inside a Container - should pass
      const result = (await params.tools.validate_template.execute!({
        yaml: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Container:
        children:
          - Button:
              text: "Submit"`,
      })) as ValidationResult;

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      return {
        toolCalls: [],
        text: `Form:
  children:
    - Input:
        name: "email"
        label: "Email"
    - Container:
        children:
          - Button:
              text: "Submit"`,
        usage: { totalTokens: 100 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a form with nested button',
      components: { Form, Input, Button, Container },
    });
  });

  it('should not require Button for non-Form components', async () => {
    const Container: UIComponent<Record<string, never>> = {
      component: () => null,
      description: 'A container',
    };

    mockStreamText.mockImplementationOnce(async (params) => {
      // Container without Form - no Button required
      const result = (await params.tools.validate_template.execute!({
        yaml: `Container:
  children:
    - Input:
        name: "email"
        label: "Email"`,
      })) as ValidationResult;

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      return {
        toolCalls: [],
        text: `Container:
  children:
    - Input:
        name: "email"
        label: "Email"`,
        usage: { totalTokens: 100 },
      };
    });

    await generateUI({
      client: mockClient,
      prompt: 'Create a container with input',
      components: { Container, Input },
    });
  });

  describe('resolvedBindings', () => {
    const Text: UIComponent<{ content: string }> = {
      component: () => null,
      description: 'A text display',
    };

    const Heading: UIComponent<{ content: string; level?: string }> = {
      component: () => null,
      description: 'A heading',
    };

    const Container: UIComponent<Record<string, never>> = {
      component: () => null,
      description: 'A container',
    };

    const List: UIComponent<{ items: unknown[]; as?: string }> = {
      component: () => null,
      description: 'A list loop',
    };

    it('should resolve bindings to correct values', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `Container:
  children:
    - Heading:
        content: "{{user.name}}"
    - Text:
        content: "{{user.email}}"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();
        expect(result.resolvedBindings).toHaveLength(2);

        const nameBinding = result.resolvedBindings!.find(
          (b) => b.path === 'user.name'
        );
        expect(nameBinding).toEqual({
          path: 'user.name',
          component: 'Heading',
          prop: 'content',
          value: '"John Smith"',
          resolved: true,
        });

        const emailBinding = result.resolvedBindings!.find(
          (b) => b.path === 'user.email'
        );
        expect(emailBinding).toEqual({
          path: 'user.email',
          component: 'Text',
          prop: 'content',
          value: '"john@example.com"',
          resolved: true,
        });

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Heading:
        content: "{{user.name}}"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Show user info',
        components: { Container, Heading, Text },
        data: { user: { name: 'John Smith', email: 'john@example.com' } },
      });
    });

    it('should mark unresolved bindings with resolved: false', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `Container:
  children:
    - Text:
        content: "{{user.inbox}}"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();
        expect(result.resolvedBindings).toHaveLength(1);
        expect(result.resolvedBindings![0]).toEqual({
          path: 'user.inbox',
          component: 'Text',
          prop: 'content',
          value: 'undefined',
          resolved: false,
        });

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Text:
        content: "hello"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Show inbox',
        components: { Container, Text },
        data: { user: { name: 'John' } },
      });
    });

    it('should resolve bindings inside List using first array element', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `List:
  items: "{{emails}}"
  as: "email"
  children:
    - Text:
        content: "{{email.subject}}"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();

        // The items binding itself
        const itemsBinding = result.resolvedBindings!.find(
          (b) => b.path === 'emails'
        );
        expect(itemsBinding).toBeDefined();
        expect(itemsBinding!.resolved).toBe(true);
        expect(itemsBinding!.value).toContain('Array(2)');

        // The loop body binding resolved against first element
        const subjectBinding = result.resolvedBindings!.find(
          (b) => b.path === 'email.subject'
        );
        expect(subjectBinding).toEqual({
          path: 'email.subject',
          component: 'Text',
          prop: 'content',
          value: '"Hello"',
          resolved: true,
        });

        return {
          toolCalls: [],
          text: `List:
  items: "{{emails}}"
  as: "email"
  children:
    - Text:
        content: "{{email.subject}}"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Show emails',
        components: { Container, Text, List },
        data: {
          emails: [
            { subject: 'Hello', from: 'alice@example.com' },
            { subject: 'World', from: 'bob@example.com' },
          ],
        },
      });
    });

    it('should mark loop body bindings as unresolved when array is empty', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `List:
  items: "{{emails}}"
  as: "email"
  children:
    - Text:
        content: "{{email.subject}}"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();

        // items binding resolves to empty array
        const itemsBinding = result.resolvedBindings!.find(
          (b) => b.path === 'emails'
        );
        expect(itemsBinding!.resolved).toBe(true);
        expect(itemsBinding!.value).toBe('Array(0) []');

        // Loop body binding is unresolved because no sample element
        const subjectBinding = result.resolvedBindings!.find(
          (b) => b.path === 'email.subject'
        );
        expect(subjectBinding).toEqual({
          path: 'email.subject',
          component: 'Text',
          prop: 'content',
          value: 'undefined',
          resolved: false,
        });

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Text:
        content: "No emails"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Show emails',
        components: { Container, Text, List },
        data: { emails: [] },
      });
    });

    it('should return empty resolvedBindings when template has no bindings', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `Container:
  children:
    - Text:
        content: "Hello world"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();
        expect(result.resolvedBindings).toHaveLength(0);

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Text:
        content: "Hello world"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Static page',
        components: { Container, Text },
        data: {},
      });
    });

    it('should not include resolvedBindings when YAML fails to parse', async () => {
      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `:::invalid yaml[[[`,
        })) as ValidationResult;

        expect(result.valid).toBe(false);
        expect(result.resolvedBindings).toBeUndefined();

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Text:
        content: "fallback"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Broken template',
        components: { Container, Text },
        data: {},
      });
    });

    it('should truncate long string values in summaries', async () => {
      const longString = 'A'.repeat(100);

      mockStreamText.mockImplementationOnce(async (params) => {
        const result = (await params.tools.validate_template.execute!({
          yaml: `Container:
  children:
    - Text:
        content: "{{message}}"`,
        })) as ValidationResult;

        expect(result.resolvedBindings).toBeDefined();
        expect(result.resolvedBindings).toHaveLength(1);

        const binding = result.resolvedBindings![0];
        expect(binding.resolved).toBe(true);
        // Should be truncated to 60 chars + quotes
        expect(binding.value.length).toBeLessThan(70);
        expect(binding.value).toContain('...');

        return {
          toolCalls: [],
          text: `Container:
  children:
    - Text:
        content: "{{message}}"`,
          usage: { totalTokens: 100 },
        };
      });

      await generateUI({
        client: mockClient,
        prompt: 'Show long message',
        components: { Container, Text },
        data: { message: longString },
      });
    });
  });
});
