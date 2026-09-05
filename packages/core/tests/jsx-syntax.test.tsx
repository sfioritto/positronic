import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { renderTemplate } from '../src/template/render.js';
import { brain } from '../src/dsl/brain.js';
import type { ObjectGenerator } from '../src/clients/types.js';

// These tests go through the real JSX transform, which the manual
// TemplateNode trees in jsx-template.test.ts cannot cover: the compiler has
// to wire up @positronic/core/jsx-runtime, and the DSL has to accept the
// result where it accepts a template.

describe('JSX syntax in templates', () => {
  it('renders a function component with children', async () => {
    const Section = ({
      title,
      children,
    }: {
      title: string;
      children?: unknown;
    }) => (
      <>
        [{title}] {children}
      </>
    );

    const result = await renderTemplate(
      <Section title="Intro">Hello {'world'}</Section>
    );

    expect(result).toBe('[Intro] Hello world');
  });

  it('prompt step accepts a JSX message', async () => {
    const generateObject = vi.fn<ObjectGenerator['generateObject']>();
    generateObject.mockResolvedValue({ object: { answer: 'yes' } } as any);
    const client = { generateObject } as unknown as ObjectGenerator;

    const testBrain = brain('jsx-syntax-test').prompt('Ask', () => ({
      message: <>Topic: {'testing'}</>,
      outputSchema: z.object({ answer: z.string() }),
    }));

    for await (const event of testBrain.run({
      client,
      currentUser: { name: 'test' },
    })) {
      void event;
    }

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Topic: testing' })
    );
  });
});
