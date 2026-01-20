import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface HeadingProps {
  content: string;
  level?: '1' | '2' | '3' | '4' | 1 | 2 | 3 | 4;
}

const HeadingComponent = ({ content, level = '2' }: HeadingProps) => {
  // Support both string and number levels for flexibility
  const numLevel = typeof level === 'string' ? parseInt(level, 10) : level;
  const Tag = `h${numLevel}` as keyof JSX.IntrinsicElements;
  return <Tag className="heading">{content}</Tag>;
};

export const Heading: UIComponent<HeadingProps> = {
  component: HeadingComponent,
  tool: {
    description: `A heading/title for sections of the page. Use level 1 for page title, level 2 for major sections, level 3-4 for subsections.`,
    parameters: z.object({
      content: z.string().describe('The heading text'),
      level: z
        .enum(['1', '2', '3', '4'])
        .optional()
        .describe('Heading level (1-4), defaults to 2. Use 1 for page title.'),
    }),
  },
};
