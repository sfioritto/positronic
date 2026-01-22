/**
 * Bundle entry point for client-side rendering.
 *
 * This file is bundled by esbuild into .positronic/dist/components.js which exposes
 * React components to window.PositronicComponents for use by generated pages.
 *
 * When you add custom components to components/index.ts, they will automatically
 * be included in the bundle.
 */
import { components } from '../components/index.js';

// Extract the React component from each UIComponent and expose to window
const PositronicComponents: Record<string, React.ComponentType<any>> = {};

for (const [name, uiComponent] of Object.entries(components)) {
  PositronicComponents[name] = uiComponent.component;
}

// Expose to window for client-side rendering
(window as unknown as { PositronicComponents: typeof PositronicComponents }).PositronicComponents =
  PositronicComponents;

export { PositronicComponents };
