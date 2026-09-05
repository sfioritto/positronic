import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Spec } from '@json-render/core';
import {
  checkFormSchema,
  describeFormFields,
} from '../src/page/form-schema-check.js';
import { testCatalog, element, submitButton } from './page-catalog.js';

function spec(...ops: ReturnType<typeof element>[]): Spec {
  const elements: Spec['elements'] = {};
  for (const op of ops) {
    elements[op.path.slice('/elements/'.length)] = op.value;
  }
  return { root: 'page', elements };
}

const emailInput = element('email', 'Input', {
  label: 'Email',
  name: 'email',
  value: { $bindState: '/form/email' },
});

describe('describeFormFields', () => {
  it('lists each field with its type, optionality, and description', () => {
    const text = describeFormFields(
      z.object({
        email: z.string().describe('Contact address'),
        count: z.number().optional(),
        agree: z.boolean(),
        plan: z.enum(['free', 'pro']),
        tags: z.array(z.string()).default([]),
      })
    );

    expect(text.split('\n')).toEqual([
      '- email: string - Contact address',
      '- count: number (optional)',
      '- agree: boolean',
      '- plan: "free" | "pro"',
      '- tags: string[] (optional)',
    ]);
  });
});

describe('checkFormSchema', () => {
  it('passes when every field is bound and a button submits', () => {
    const issues = checkFormSchema(
      spec(
        element('page', 'Stack', {}, { children: ['email', 'submit'] }),
        emailInput,
        submitButton
      ),
      testCatalog,
      z.object({ email: z.string(), nickname: z.string().optional() })
    );

    expect(issues).toEqual([]);
  });

  it('reports required fields nothing binds to', () => {
    const issues = checkFormSchema(
      spec(
        element('page', 'Stack', {}, { children: ['email', 'submit'] }),
        emailInput,
        submitButton
      ),
      testCatalog,
      z.object({ email: z.string(), agree: z.boolean() })
    );

    expect(issues).toEqual([
      expect.stringContaining('Missing form field "agree"'),
    ]);
  });

  it('reports bindings under /form that the schema does not expect', () => {
    const issues = checkFormSchema(
      spec(
        element(
          'page',
          'Stack',
          {},
          { children: ['email', 'extra', 'submit'] }
        ),
        emailInput,
        element('extra', 'Input', {
          label: 'Extra',
          name: 'extra',
          value: { $bindState: '/form/extra' },
        }),
        submitButton
      ),
      testCatalog,
      z.object({ email: z.string() })
    );

    expect(issues).toEqual([
      expect.stringContaining('"/form/extra" is not an expected form field'),
    ]);
  });

  it('reports inputs whose bound prop yields the wrong type', () => {
    const issues = checkFormSchema(
      spec(
        element('page', 'Stack', {}, { children: ['agree', 'submit'] }),
        element('agree', 'Input', {
          label: 'Agree?',
          name: 'agree',
          value: { $bindState: '/form/agree' },
        }),
        submitButton
      ),
      testCatalog,
      z.object({ agree: z.boolean() })
    );

    expect(issues).toEqual([
      'Form field "agree" is bound on Input.value, which yields string, but the form expects boolean.',
    ]);
  });

  it('accepts a text input for a number field, since forms submit text', () => {
    const issues = checkFormSchema(
      spec(
        element('page', 'Stack', {}, { children: ['age', 'submit'] }),
        element('age', 'Input', {
          label: 'Age',
          name: 'age',
          type: 'number',
          value: { $bindState: '/form/age' },
        }),
        submitButton
      ),
      testCatalog,
      z.object({ age: z.number() })
    );

    expect(issues).toEqual([]);
  });

  it('treats a checkbox with a value inside a repeat as a string array', () => {
    const page = spec(
      element('page', 'Stack', {}, { children: ['list', 'submit'] }),
      element(
        'list',
        'Stack',
        {},
        { repeat: { statePath: '/emails', key: 'id' }, children: ['pick'] }
      ),
      element('pick', 'Checkbox', {
        label: { $item: 'subject' },
        name: 'selected',
        checked: { $bindState: '/form/selected' },
        value: { $item: 'id' },
      }),
      submitButton
    );

    expect(
      checkFormSchema(
        page,
        testCatalog,
        z.object({ selected: z.array(z.string()) })
      )
    ).toEqual([]);
    expect(
      checkFormSchema(page, testCatalog, z.object({ selected: z.boolean() }))
    ).toEqual([
      'Form field "selected" is bound on Checkbox.checked, which yields string[], but the form expects boolean.',
    ]);
  });

  it('reads array-valued inputs from the catalog prop schema', () => {
    const issues = checkFormSchema(
      spec(
        element('page', 'Stack', {}, { children: ['tags', 'submit'] }),
        element('tags', 'MultiTextInput', {
          label: 'Tags',
          name: 'tags',
          value: { $bindState: '/form/tags' },
        }),
        submitButton
      ),
      testCatalog,
      z.object({ tags: z.array(z.string()) })
    );

    expect(issues).toEqual([]);
  });

  it('requires something to trigger submitForm', () => {
    const issues = checkFormSchema(
      spec(element('page', 'Stack', {}, { children: ['email'] }), emailInput),
      testCatalog,
      z.object({ email: z.string() })
    );

    expect(issues).toEqual([
      expect.stringContaining('Nothing submits the form'),
    ]);
  });
});
