// React implementations for the catalog in ./index.ts.
//
// Only the page bundle (.positronic/bundle.ts) imports this file, so it may
// import React. Every component in the catalog needs an entry here.
// Implementations receive `{ props, children, bindings, emit }` from
// json-render; see `@json-render/react` for the hooks that read and write
// page state.
//
// Custom implementations are React components. Put each one in a `.tsx`
// file whose first line is `/** @jsxImportSource react */` (the project
// tsconfig points JSX at Positronic's prompt runtime otherwise), then add it
// to `pageComponents` below:
//
//   // src/components/price-tag.tsx
//   /** @jsxImportSource react */
//   import type { BaseComponentProps } from '@json-render/react';
//
//   export function PriceTag({ props }: BaseComponentProps<{ amount: number; currency: string }>) {
//     return <span className="font-mono">{props.currency} {props.amount.toFixed(2)}</span>;
//   }
//
//   import { PriceTag } from './price-tag.js';
//   export const pageComponents = { ...components, PriceTag };
import { components } from '@positronic/gen-ui-components';

export const pageComponents = components;
