// Development entry for the automatic JSX transform. Vite and other dev
// tooling import jsxDEV from `<jsxImportSource>/jsx-dev-runtime` instead of
// jsx/jsxs from jsx-runtime. The extra arguments the transform passes (key,
// isStaticChildren, source, self) carry debug information we do not use.
import { jsx, type ElementType } from './jsx-runtime.js';

export * from './jsx-runtime.js';

export function jsxDEV(type: ElementType, props: Record<string, unknown>) {
  return jsx(type, props);
}
