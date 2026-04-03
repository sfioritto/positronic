import { z } from 'zod';
import type { ObjectGenerator, JsonValue } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { typeCheckData } from '../sandbox.js';

/**
 * Use an LLM agent loop to generate realistic fake data that conforms to
 * the given TypeScript interface. The LLM writes JSON, type-checks it
 * against the interface, and iterates until it passes.
 */
export async function generateFakeData(
  client: ObjectGenerator,
  sandbox: SandboxInstance,
  inputSchema: string
): Promise<{
  fakeData: Record<string, unknown>;
  responseMessages: JsonValue[];
}> {
  let fakeData: Record<string, unknown> = {};
  let fakeDataJson: string | null = null;

  const result = await client.streamText({
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
          const typeCheckResult = await typeCheckData(
            sandbox,
            json,
            inputSchema
          );
          if (typeCheckResult.success) {
            return {
              status: 'success',
              message:
                'Data type-checks successfully. Call submit_data to finish.',
            };
          }
          return {
            status: 'error',
            message: 'Type errors found. Fix them and try again.',
            errors: typeCheckResult.errors,
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

  return { fakeData, responseMessages: result.responseMessages };
}
