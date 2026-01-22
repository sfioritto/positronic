import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

const ContainerPropsSchema = z.object({
  direction: z
    .enum(['row', 'column'])
    .optional()
    .describe('Layout direction - row (horizontal) or column (vertical, default)'),
  gap: z
    .enum(['none', 'small', 'medium', 'large'])
    .optional()
    .describe('Spacing between children, defaults to medium'),
  padding: z
    .enum(['none', 'small', 'medium', 'large'])
    .optional()
    .describe('Inner padding, defaults to none'),
});

export type ContainerProps = z.infer<typeof ContainerPropsSchema> & {
  children?: ReactNode;
};

const directionClasses = {
  row: 'flex-row',
  column: 'flex-col',
};

const gapClasses = {
  none: 'gap-0',
  small: 'gap-2',
  medium: 'gap-4',
  large: 'gap-6',
};

const paddingClasses = {
  none: 'p-0',
  small: 'p-2',
  medium: 'p-4',
  large: 'p-6',
};

const ContainerComponent = ({
  children,
  direction = 'column',
  gap = 'medium',
  padding = 'none',
}: ContainerProps) => (
  <div className={`flex ${directionClasses[direction]} ${gapClasses[gap]} ${paddingClasses[padding]}`}>
    {children}
  </div>
);

export const Container: UIComponent<ContainerProps> = {
  component: ContainerComponent,
  description: `A layout container that groups child components. Use to organize page sections, create visual hierarchy, add spacing. Children are placed inside this container.`,
  propsSchema: ContainerPropsSchema,
};
