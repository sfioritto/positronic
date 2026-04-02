import { z } from 'zod';
import type { ObjectGenerator } from '@positronic/core';
import type { SurfaceSandbox } from './sandbox/index.js';
import { screenshot } from './screenshot.js';

export interface ToolCallLog {
  tool: string;
  args: unknown;
  result: unknown;
  durationMs: number;
}

export interface GenerateResult {
  html: string;
  screenshots?: Uint8Array[];
  log?: {
    systemPrompt: string;
    userPrompt: string;
    fakeData: Record<string, unknown>;
    toolCalls: ToolCallLog[];
    totalDurationMs: number;
  };
}

/**
 * Generate a self-contained HTML page using an LLM + sandbox loop.
 *
 * The LLM writes TSX components, type-checks them, previews screenshots,
 * validates forms, and submits when satisfied. Returns the final HTML.
 */
export async function generate(params: {
  client: ObjectGenerator;
  sandbox: SurfaceSandbox;
  systemPrompt: string;
  accountId: string;
  apiToken: string;
  prompt: string;
  inputSchema: string;
  outputSchema?: string;
  debug?: boolean;
}): Promise<GenerateResult> {
  const {
    client,
    sandbox,
    systemPrompt,
    accountId,
    apiToken,
    prompt,
    inputSchema,
    outputSchema,
    debug,
  } = params;

  const startTime = Date.now();
  const toolCallLog: ToolCallLog[] = [];

  function truncateBase64(obj: unknown): unknown {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(truncateBase64);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 200) {
        // Check if it looks like base64 (alphanumeric, +, /, =)
        if (/^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100))) {
          result[key] = `[base64 ${value.length} chars]`;
          continue;
        }
      }
      result[key] = truncateBase64(value);
    }
    return result;
  }

  function wrapExecute(
    toolName: string,
    fn: (args: any) => Promise<unknown>
  ): (args: any) => Promise<unknown> {
    return async (args) => {
      const start = Date.now();
      const result = await fn(args);
      if (debug) {
        toolCallLog.push({
          tool: toolName,
          args:
            toolName === 'write_component'
              ? { source: '...' + String((args as any).source).slice(-100) }
              : args,
          result: truncateBase64(result),
          durationMs: Date.now() - start,
        });
      }
      return result;
    };
  }

  // Step 1: Generate fake data using an LLM agent loop with type-checking
  let fakeData: Record<string, unknown> = {};
  let fakeDataJson: string | null = null;

  await client.streamText({
    prompt: `Generate realistic fake/sample data as JSON that conforms to this TypeScript interface. Make it look like real production data (realistic names, plausible numbers, multiple items in arrays, etc.), not test placeholders. Include 3-5 items in any arrays.

Interface:
${inputSchema}

Instructions:
1. Write JSON data using write_data — it will be type-checked against the interface
2. Fix any type errors and rewrite
3. Call submit_data when the data type-checks successfully`,
    tools: {
      write_data: {
        description:
          'Write JSON data and type-check it against the Data interface. Returns type errors if any.',
        inputSchema: z.object({
          json: z
            .string()
            .describe('A JSON object matching the Data interface'),
        }),
        async execute({ json }: any) {
          fakeDataJson = json;
          const result = await sandbox.typeCheckData(json, inputSchema);
          if (result.success) {
            return {
              status: 'success',
              message:
                'Data type-checks successfully. Call submit_data to finish.',
            };
          }
          return {
            status: 'error',
            message: 'Type errors found. Fix them and try again.',
            errors: result.errors,
          };
        },
      },
      submit_data: {
        description:
          'Submit the current data as final. Only call after write_data succeeds.',
        inputSchema: z.object({}),
        async execute() {
          if (!fakeDataJson) {
            return {
              status: 'error',
              message: 'No data written yet. Call write_data first.',
            };
          }
          try {
            fakeData = JSON.parse(fakeDataJson);
          } catch {
            return {
              status: 'error',
              message:
                'JSON parse failed. Fix the JSON and call write_data again.',
            };
          }
          return { status: 'success', message: 'Data submitted.' };
        },
      },
    },
    maxSteps: 10,
    toolChoice: 'auto',
  });

  // Track state across tool calls
  let lastSource: string | null = null;
  let submitted = false;
  const screenshots: Uint8Array[] = [];

  // Step 2: Define tools
  const tools: Record<
    string,
    {
      description: string;
      inputSchema: z.ZodSchema;
      execute: (args: any) => Promise<unknown>;
      toModelOutput?: (params: { output: unknown }) => unknown;
    }
  > = {
    write_component: {
      description:
        'Write or rewrite the TSX component. The component will be type-checked against the data schema and available shadcn components. Returns type errors if any, or success.',
      inputSchema: z.object({
        source: z
          .string()
          .describe('The complete TSX source code for the component'),
      }),
      async execute({ source }: { source: string }) {
        lastSource = source;
        const result = await sandbox.typeCheck(
          source,
          inputSchema,
          outputSchema
        );
        if (result.success) {
          return {
            status: 'success',
            message: 'Component type-checks successfully.',
          };
        }
        return {
          status: 'error',
          message: 'Type errors found. Fix them and try again.',
          errors: result.errors,
        };
      },
    },

    preview: {
      description:
        'Build and screenshot the current component with sample data. Use this to see what your component looks like rendered in a browser. The component must be written first via write_component.',
      inputSchema: z.object({}),
      async execute() {
        if (!lastSource) {
          return {
            status: 'error',
            message: 'No component written yet. Call write_component first.',
          };
        }

        const htmlResult = await sandbox.buildHtml(fakeData);
        if (!htmlResult.success) {
          return {
            status: 'error',
            message: 'Failed to build HTML.',
            errors: htmlResult.errors,
          };
        }

        const png = await screenshot({
          html: htmlResult.html!,
          accountId,
          apiToken,
        });

        if (debug) {
          screenshots.push(png);
        }

        // Return base64 image data — toModelOutput converts it to visual content
        const base64 = btoa(String.fromCharCode(...png));
        return {
          type: 'image',
          data: base64,
        };
      },
      toModelOutput({ output }: { output: unknown }) {
        const result = output as { type: string; data?: string };
        if (result.type === 'image' && result.data) {
          return {
            type: 'content',
            value: [
              { type: 'text', text: 'Screenshot of the rendered component:' },
              { type: 'media', data: result.data, mediaType: 'image/png' },
            ],
          };
        }
        return {
          type: 'content',
          value: [{ type: 'text', text: JSON.stringify(output) }],
        };
      },
    },

    submit: {
      description:
        'Submit the current component as the final version. Call this when you are satisfied with the component after previewing it.',
      inputSchema: z.object({}),
      async execute() {
        if (!lastSource) {
          return {
            status: 'error',
            message: 'No component written yet. Call write_component first.',
          };
        }
        submitted = true;
        return { status: 'success', message: 'Component submitted.' };
      },
    },
  };

  // Add form validation tool if outputSchema is provided
  if (outputSchema) {
    tools.validate_form = {
      description:
        'Validate that the form in the component has inputs for all required fields in the output schema. The component must be written first via write_component.',
      inputSchema: z.object({}),
      async execute() {
        if (!lastSource) {
          return {
            status: 'error',
            message: 'No component written yet. Call write_component first.',
          };
        }

        // Bundle with external React for JSDOM testing
        const bundleResult = await sandbox.bundle('external-react');
        if (!bundleResult.success) {
          return {
            status: 'error',
            message: 'Failed to bundle.',
            errors: bundleResult.errors,
          };
        }

        const result = await sandbox.validateForm(outputSchema);
        if (result.success) {
          return {
            status: 'success',
            message:
              'Form validation passed. All schema fields have corresponding inputs.',
          };
        }
        return {
          status: 'error',
          message: 'Form validation failed. Fix the form and try again.',
          errors: result.errors,
        };
      },
    };
  }

  // Wrap all tool execute functions with logging
  for (const [name, tool] of Object.entries(tools)) {
    tool.execute = wrapExecute(name, tool.execute);
  }

  // Step 3: Build the user prompt with schema context
  let userPrompt = prompt;
  userPrompt += `\n\nIMPORTANT: Import all components from '@surface/components'. Do NOT use '@/components/ui/...' paths.`;
  userPrompt += `\n\nThe component receives a \`data\` prop with this TypeScript interface:\n\`\`\`typescript\n${inputSchema}\n\`\`\``;
  if (outputSchema) {
    userPrompt += `\n\nThe component must include a form that submits data matching this schema:\n\`\`\`typescript\n${outputSchema}\n\`\`\``;
    userPrompt += `\n\nAfter writing the component, use validate_form to verify the form fields match the schema.`;
  }
  userPrompt += `\n\nInstructions:\n1. Write the component using write_component\n2. Preview it to see how it looks\n3. Iterate until satisfied\n4. Call submit when done`;

  // Step 4: Run the generation loop
  await client.streamText({
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    maxSteps: 20,
    toolChoice: 'auto',
  });

  // Step 5: Build final HTML
  if (!lastSource) {
    throw new Error('Generation loop completed without writing any component');
  }

  // If not submitted, use the last written component as fallback
  const htmlResult = await sandbox.buildHtml(fakeData);
  if (!htmlResult.success) {
    throw new Error(`Failed to build final HTML: ${htmlResult.errors}`);
  }

  return {
    html: htmlResult.html!,
    screenshots: debug ? screenshots : undefined,
    log: debug
      ? {
          systemPrompt,
          userPrompt,
          fakeData: fakeData as Record<string, unknown>,
          toolCalls: toolCallLog,
          totalDurationMs: Date.now() - startTime,
        }
      : undefined,
  };
}
