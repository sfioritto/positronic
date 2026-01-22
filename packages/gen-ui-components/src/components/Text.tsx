import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const TextPropsSchema = z.object({
  content: z.string().describe('The text content to display'),
  variant: z
    .enum(['body', 'small', 'muted'])
    .optional()
    .describe('Text style - body (normal), small (smaller), muted (less prominent)'),
});

export type TextProps = z.infer<typeof TextPropsSchema>;

const variantClasses = {
  body: 'text-base text-gray-700',
  small: 'text-sm text-gray-600',
  muted: 'text-sm text-gray-500',
};

const TextComponent = ({ content, variant = 'body' }: TextProps) => (
  <p className={variantClasses[variant]}>{content}</p>
);

export const Text: UIComponent<TextProps> = {
  component: TextComponent,
  description: `A paragraph of text for displaying information. Use for descriptions, instructions, or any body text. Not a form input - just displays content.`,
  propsSchema: TextPropsSchema,
};
