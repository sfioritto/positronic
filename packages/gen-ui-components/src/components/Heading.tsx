import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const HeadingPropsSchema = z.object({
  content: z.string().describe('The heading text'),
  level: z
    .enum(['1', '2', '3', '4'])
    .optional()
    .describe('Heading level (1-4), defaults to 2. Use 1 for page title.'),
});

export type HeadingProps = z.infer<typeof HeadingPropsSchema> & {
  // Allow numeric level for runtime flexibility
  level?: '1' | '2' | '3' | '4' | 1 | 2 | 3 | 4;
};

const levelClasses = {
  1: 'text-3xl',
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
};

const HeadingComponent = ({ content, level = '2' }: HeadingProps) => {
  const numLevel = typeof level === 'string' ? parseInt(level, 10) : level;
  const Tag = `h${numLevel}` as keyof JSX.IntrinsicElements;
  return <Tag className={`font-semibold text-gray-900 ${levelClasses[numLevel as keyof typeof levelClasses]}`}>{content}</Tag>;
};

export const Heading: UIComponent<HeadingProps> = {
  component: HeadingComponent,
  description: `A heading/title for sections of the page. Use level 1 for page title, level 2 for major sections, level 3-4 for subsections.`,
  propsSchema: HeadingPropsSchema,
};
