/**
 * UI Components for this project.
 *
 * This file re-exports the default Positronic components and is the place
 * to add your own custom components.
 *
 * To add a custom component:
 * 1. Create a component file (e.g., CustomButton.ts) with UIComponent structure
 * 2. Import and add it to the components object below
 *
 * @example
 * ```typescript
 * import { CustomButton } from './CustomButton.js';
 *
 * export const components = {
 *   ...defaultComponents,
 *   CustomButton,
 * };
 * ```
 */
import { components as defaultComponents } from '@positronic/gen-ui-components';

// Re-export default components - add your custom components here
export const components = {
  ...defaultComponents,
};
