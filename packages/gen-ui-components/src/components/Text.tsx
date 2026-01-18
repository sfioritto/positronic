import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface TextProps {
  content: string;
  variant?: 'body' | 'small' | 'muted';
}

const TextComponent = ({ content, variant = 'body' }: TextProps) => (
  <p className={`text text-${variant}`}>{content}</p>
);

export const Text: UIComponent<TextProps> = {
  component: TextComponent,
  tool: {
    description: `A paragraph of text for displaying information. Use for descriptions, instructions, or any body text. Not a form input - just displays content.`,
    parameters: z.object({
      content: z.string().describe('The text content to display'),
      variant: z
        .enum(['body', 'small', 'muted'])
        .optional()
        .describe('Text style - body (normal), small (smaller), muted (less prominent)'),
    }),
  },
};
