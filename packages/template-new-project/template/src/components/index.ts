/**
 * The component catalog for generated pages.
 *
 * This is what the page generator can place: shadcn/ui components from
 * `@positronic/gen-ui-components` plus anything you add here. Each
 * definition is a Zod props schema and a description the model reads.
 * The React implementation for each one lives in ./browser.ts.
 *
 * To add a component:
 *
 * ```typescript
 * import { z } from 'zod';
 *
 * export const catalog = definePageCatalog({
 *   components: {
 *     ...definitions,
 *     PriceTag: {
 *       props: z.object({ amount: z.number(), currency: z.string() }),
 *       description: 'A formatted price. Use for money.',
 *     },
 *   },
 *   actions,
 * });
 * ```
 *
 * This file is imported by both the brain (server) and the page bundle
 * (browser), so keep it free of React and Node-only imports.
 */
import { definePageCatalog } from '@positronic/core/page';
import { definitions, actions } from '@positronic/gen-ui-components/catalog';

export const catalog = definePageCatalog({ components: definitions, actions });
