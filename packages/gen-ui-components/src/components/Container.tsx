import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

export interface ContainerProps {
  children?: ReactNode;
  direction?: 'row' | 'column';
  gap?: 'none' | 'small' | 'medium' | 'large';
  padding?: 'none' | 'small' | 'medium' | 'large';
}

const ContainerComponent = ({
  children,
  direction = 'column',
  gap = 'medium',
  padding = 'none',
}: ContainerProps) => (
  <div
    className={`container direction-${direction} gap-${gap} padding-${padding}`}
  >
    {children}
  </div>
);

export const Container: UIComponent<ContainerProps> = {
  component: ContainerComponent,
  tool: {
    description: `A layout container that groups child components. Use to organize page sections, create visual hierarchy, add spacing. Children are placed inside this container.`,
    parameters: z.object({
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
    }),
  },
};
