import type { ComponentType } from 'react';
import type { z } from 'zod';

/**
 * A UI component that can be used by the LLM to build pages.
 * Combines a React component with metadata for the LLM.
 */
export interface UIComponent<TProps = unknown> {
  /** React component for rendering this UI element. */
  component: ComponentType<TProps>;
  /** Description of what this component does and when to use it. */
  description: string;
  /** Zod schema defining the props for this component. */
  propsSchema?: z.ZodObject<z.ZodRawShape>;
}
