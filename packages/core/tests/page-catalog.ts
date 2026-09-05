import { z } from 'zod';
import { definePageCatalog } from '../src/page/schema.js';

/**
 * A small catalog for page tests. Mirrors the shape of the real one:
 * inputs carry a `name` and a bindable value prop, the Button emits `press`,
 * and `submitForm` is the action that posts the form.
 */
export const testCatalog = definePageCatalog({
  components: {
    Stack: {
      props: z.object({ gap: z.number().optional() }),
      slots: ['default'],
      description: 'Vertical layout',
    },
    Heading: {
      props: z.object({ text: z.string() }),
      description: 'Section title',
    },
    Text: {
      props: z.object({ content: z.string() }),
      description: 'Paragraph of text',
    },
    Input: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        type: z.enum(['text', 'email', 'number']).optional(),
        value: z.string().nullable().optional(),
      }),
      events: ['change'],
      description: 'Text input. Bind value with $bindState.',
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        checked: z.boolean().nullable().optional(),
        value: z.string().optional(),
      }),
      events: ['change'],
      description: 'Checkbox. Bind checked with $bindState.',
    },
    MultiTextInput: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        value: z.array(z.string()).optional(),
      }),
      description: 'A growable list of text values.',
    },
    Button: {
      props: z.object({ label: z.string() }),
      events: ['press'],
      description: 'Button. Bind on.press.',
    },
  },
  actions: {
    submitForm: { description: 'Submit the form to the host' },
  },
});

/** Serialize patch operations as the JSONL the model emits. */
export function jsonl(...ops: object[]): string {
  return ops.map((op) => JSON.stringify(op)).join('\n');
}

/** An `add /elements/<key>` patch. */
export function element(
  key: string,
  type: string,
  props: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  return {
    op: 'add',
    path: `/elements/${key}`,
    value: { type, props, children: [], ...extra },
  };
}

export const submitButton = element(
  'submit',
  'Button',
  { label: 'Submit' },
  { on: { press: [{ action: 'validateForm' }, { action: 'submitForm' }] } }
);
