import { z } from 'zod';
import type { ObjectGenerator, JsonValue } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { typeCheckData } from '../sandbox.js';

export type DatasetVariant = 'empty' | 'sparse' | 'typical' | 'large';

const DATASET_VARIANTS: readonly DatasetVariant[] = [
  'empty',
  'sparse',
  'typical',
  'large',
];

export type FakeDatasets = Record<DatasetVariant, Record<string, unknown>>;

// Per-variant guidance appended to the base fake-data prompt. Each variant
// tests a different part of the layout's design envelope.
const VARIANT_SPECS: Record<DatasetVariant, string> = {
  empty: `Generate the EMPTY dataset variant.

- Every array field in the schema must be an empty array ([]).
- Every scalar (top-level or nested outside arrays) must still be populated with a realistic value — page titles, organization names, date ranges, period labels, user names, etc.
- This represents the "no results came back for this request" case. The page shell is intact; the content lists are empty. Do NOT omit required scalar fields.`,

  sparse: `Generate the SPARSE dataset variant.

- Primary/top-level arrays should contain 1-2 items each.
- Nested inner arrays (e.g. PRs inside a developer, accomplishments inside a summary, items inside a receipt, thread attachments) should contain 0-1 items each.
- All scalar fields populated realistically.
- This represents the "barely any activity" case — stress-tests how the layout handles mostly-empty sections without looking broken.`,

  typical: `Generate the TYPICAL dataset variant.

- Primary/top-level arrays should contain 6-10 items each.
- Nested inner arrays should contain 2-4 items each.
- Use varied string lengths — some short, some medium, some long — to exercise wrapping, truncation, and alignment.
- Plausible numeric values with real variance (not all "42" / "100").
- Realistic content: plausible PR titles, email subjects, product names, user names, etc.
- This represents a realistic everyday use case.`,

  large: `Generate the LARGE dataset variant.

- Primary/top-level arrays should contain 30-50 items each.
- Nested inner arrays should contain 5-8 items each.
- Use varied string lengths. Vary numeric values widely (e.g. for PRs: a few very small counts, some mid-range, a few large).
- Realistic content throughout — no "Item 1 / Item 2 / Item 3" filler even at this volume.
- This represents a high-volume user or team. It stress-tests whether the layout stays readable at scale or collapses into a wall of repetitive content.`,
};

// Instructions common to every variant.
const COMMON_GUIDANCE = `Content quality (applies to every variant):
- Real-looking names, organizations, dates, URLs, product names. NOT test placeholders.
- Plausible numeric values with variance.
- If the schema references PRs, tickets, emails, or similar records, use realistic IDs, subjects, and bodies with actual content.
- Keep the data internally consistent — e.g. if an email has 5 comments listed in meta, the comments array should have 5 items where possible.`;

async function generateOneVariant(
  client: ObjectGenerator,
  sandbox: SandboxInstance,
  inputSchema: string,
  variant: DatasetVariant
): Promise<{
  fakeData: Record<string, unknown>;
  responseMessages: JsonValue[];
}> {
  let fakeData: Record<string, unknown> | null = null;
  let fakeDataJson: string | null = null;

  const result = await client.streamText({
    prompt: `Generate realistic fake/sample data as JSON that conforms to this TypeScript interface.

Interface:
${inputSchema}

${VARIANT_SPECS[variant]}

${COMMON_GUIDANCE}

Instructions:
1. Write JSON data using write_data — it will be type-checked against the interface.
2. Fix any type errors and rewrite.
3. Call submit_data when the data type-checks successfully.`,
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

  if (fakeData === null) {
    throw new Error(
      `Fake-data generation for variant "${variant}" did not converge — the model exited without calling submit_data successfully. Check the input schema and the model's maxSteps budget.`
    );
  }

  return { fakeData, responseMessages: result.responseMessages };
}

/**
 * Generate four fake-data variants (empty, sparse, typical, large) in
 * sequence. Each variant runs its own typed LLM loop against the shared
 * sandbox so type-checking is isolated.
 *
 * The variants exist so designs get stress-tested across the realistic
 * data-volume distribution. Preview uses `typical` by default for the
 * generator's feedback loop; downstream tooling can use the others for
 * multi-viewport / multi-data-size review passes.
 */
export async function generateFakeDatasets(
  client: ObjectGenerator,
  sandbox: SandboxInstance,
  inputSchema: string
): Promise<{
  datasets: FakeDatasets;
  responseMessages: JsonValue[];
}> {
  const datasets: Partial<FakeDatasets> = {};
  const allMessages: JsonValue[] = [];

  // Serial execution: the sandbox's type-check files (types.ts, data-check.ts)
  // are shared paths inside a single DO container. Running variants in
  // parallel would race on those files. Serial is simple and correct; with
  // a cheap/fast model the overall wall-clock is acceptable.
  for (const variant of DATASET_VARIANTS) {
    const { fakeData, responseMessages } = await generateOneVariant(
      client,
      sandbox,
      inputSchema,
      variant
    );
    datasets[variant] = fakeData;
    allMessages.push(...responseMessages);
  }

  return {
    datasets: datasets as FakeDatasets,
    responseMessages: allMessages,
  };
}
