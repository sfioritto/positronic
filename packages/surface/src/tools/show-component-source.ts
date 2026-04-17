import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import {
  getComponentSource,
  listComponentNames,
} from '../component-sources.gen.js';

export function showComponentSourceTool(): StreamTool {
  return {
    description:
      'Return the full TSX source of any @surface/components component by exported name. CALL THIS FIRST whenever the reviewer flags that a specific component (Button, Field, Checkbox, etc.) is rendering wrong — the source shows exactly which variants and classes the component uses, so you can match its expectations rather than guessing. Multiple related exports often share one file (e.g. Field, FieldGroup, FieldLabel all live in field.tsx).',
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          'The exported component name (case-sensitive), e.g. "Field" or "CardHeader".'
        ),
    }),
    async execute({ name }: any) {
      const entry = getComponentSource(name);
      if (!entry) {
        const known = listComponentNames();
        const lower = name.toLowerCase();
        const suggestions = known.filter((n) =>
          n.toLowerCase().includes(lower)
        );
        return {
          status: 'error',
          message: `No @surface/components export named "${name}".${
            suggestions.length
              ? ` Did you mean one of: ${suggestions.slice(0, 5).join(', ')}?`
              : ''
          }`,
          known,
        };
      }
      return {
        status: 'success',
        name,
        fileName: entry.fileName,
        exports: entry.exports,
        source: entry.source,
      };
    },
  };
}
