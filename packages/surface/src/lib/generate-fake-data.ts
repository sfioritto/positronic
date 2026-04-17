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
    prompt: `Generate realistic fake/sample data as JSON that conforms to this TypeScript interface. Make it look like real production data (realistic names, plausible numbers, rich array contents) — NOT test placeholders.

Array sizing (IMPORTANT):
- Include AT LEAST 6 items in any top-level or list-shaped array, unless the schema or field name clearly implies a smaller count (e.g. a single-choice tuple, a fixed-shape pair, a field literally named "top3" or "selected").
- Aim for 6-10 items in the primary list(s) on the page. Do not stop at 3 — a 3-item list looks sparse and gives the generated UI too little to work with.
- For nested arrays (e.g. accomplishments inside each developer, comments inside each thread), include 2-4 items per inner list so the layout has real content to render.

Content quality:
- Real-looking names, organizations, dates, URLs, product names.
- Vary string lengths — some short, some medium, some long — so the layout gets stress-tested for wrapping, truncation, and alignment.
- Plausible numeric values (not all "42" / "100").
- If the schema references PRs, tickets, emails, or similar records, use realistic IDs, subjects, and bodies with actual content.

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
