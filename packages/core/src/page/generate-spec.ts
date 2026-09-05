import {
  autoFixSpec,
  buildUserPrompt,
  compileSpecStream,
  validateSpec,
  type Spec,
} from '@json-render/core';
import type { z } from 'zod';
import type { ObjectGenerator } from '../clients/types.js';
import { IterateResult } from '../dsl/iterate-result.js';
import { describeDataShape } from './describe-data.js';
import { checkFormSchema, describeFormFields } from './form-schema-check.js';
import type { PageCatalog } from './schema.js';

export interface GenerateSpecParams {
  client: ObjectGenerator;
  /** What the page should show and collect */
  prompt: string;
  catalog: PageCatalog;
  /** Data the page renders; seeded into the spec's state before rendering */
  props?: Record<string, unknown>;
  /** Fields the page's form must collect */
  formSchema?: z.ZodObject<any>;
  /** The page collects input even though no schema is known (generatePage tool) */
  hasForm?: boolean;
  /** Rounds of validation feedback before giving up. Default 2. */
  maxRepairs?: number;
}

export interface GenerateSpecResult {
  spec: Spec;
  usage: { totalTokens: number };
  /** Issues sent back to the model, one entry per repair round */
  repairs: string[][];
}

/** IterateResult values unwrap to plain arrays so the model sees a clean shape. */
function toState(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      value instanceof IterateResult ? value.values : value,
    ])
  );
}

// The step's props win over anything the model wrote at the same keys.
function seedState(spec: Spec, state: Record<string, unknown>): Spec {
  return { ...spec, state: { ...spec.state, ...state } };
}

function withoutState({ state, ...spec }: Spec): Spec {
  return spec;
}

function buildInitialPrompt(
  prompt: string,
  state: Record<string, unknown>,
  formSchema: z.ZodObject<any> | undefined,
  hasForm: boolean
): string {
  const sections: string[] = [];

  if (Object.keys(state).length > 0) {
    sections.push(
      '## State\nAlready seeded; read these paths with $state and repeat, do not add sample data.\n```typescript\n' +
        describeDataShape(state, { includeExamples: false }) +
        '\n```'
    );
  }

  sections.push(`## Instructions\n${prompt}`);

  if (formSchema) {
    sections.push(
      `## Form\nCollect exactly these fields under /form:\n${describeFormFields(formSchema)}`
    );
  } else if (hasForm) {
    sections.push(
      '## Form\nThis page collects user input. Bind each input under /form/<name> and end with the submit button.'
    );
  }

  return sections.join('\n\n');
}

function collectIssues(
  spec: Spec,
  catalog: PageCatalog,
  formSchema: z.ZodObject<any> | undefined
): string[] {
  const issues = validateSpec(spec)
    .issues.filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);

  const catalogResult = catalog.validate(spec);
  if (!catalogResult.success && catalogResult.error) {
    for (const issue of catalogResult.error.issues) {
      issues.push(`${issue.path.join('/')}: ${issue.message}`);
    }
  }

  if (formSchema) {
    issues.push(...checkFormSchema(spec, catalog, formSchema));
  }

  return issues;
}

/**
 * Generate a json-render spec for a page.
 *
 * One generation call, then up to `maxRepairs` rounds where the validation
 * issues go back to the model as a patch request against the current spec.
 * Throws when issues remain after the last round.
 */
export async function generateSpec(
  params: GenerateSpecParams
): Promise<GenerateSpecResult> {
  const {
    client,
    prompt,
    catalog,
    props = {},
    formSchema,
    hasForm = formSchema !== undefined,
    maxRepairs = 2,
  } = params;

  const state = toState(props);
  const system = catalog.prompt({ editModes: ['patch'] });
  const repairs: string[][] = [];
  let totalTokens = 0;

  const generate = async (userPrompt: string, base: Spec) => {
    const result = await client.streamText({
      system,
      prompt: userPrompt,
      tools: {},
      maxSteps: 1,
      toolChoice: 'none',
    });
    totalTokens += result.usage.totalTokens;
    // compileSpecStream wants an index signature; Spec is an interface without one.
    const compiled = compileSpecStream(result.text ?? '', { ...base }) as Spec;
    return seedState(compiled, state);
  };

  let spec = await generate(
    buildInitialPrompt(prompt, state, formSchema, hasForm),
    { root: '', elements: {} }
  );

  for (let round = 0; ; round++) {
    const lastRound = round >= maxRepairs;
    // Lossy fixes prune content the model forgot; only accept them once the
    // model has had its chances to add it.
    spec = autoFixSpec(spec, { lossy: lastRound }).spec;
    const issues = collectIssues(spec, catalog, formSchema);
    if (issues.length === 0) break;

    if (lastRound) {
      throw new Error(
        `Page generation failed after ${maxRepairs} repair round(s):\n- ${issues.join('\n- ')}`
      );
    }

    repairs.push(issues);
    spec = await generate(
      buildUserPrompt({
        prompt: `Fix these problems in the UI spec:\n- ${issues.join('\n- ')}`,
        currentSpec: withoutState(spec),
        editModes: ['patch'],
      }),
      withoutState(spec)
    );
  }

  return { spec, usage: { totalTokens }, repairs };
}
