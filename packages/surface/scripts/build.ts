import { build } from 'esbuild';
import mdx from '@mdx-js/esbuild';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(dir, '..', 'src');

// Collect all .ts/.tsx entry points (excluding .d.ts)
function getEntryPoints(dir: string, prefix = ''): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      entries.push(...getEntryPoints(path, rel));
    } else if (
      (entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.mdx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      entries.push(path);
    }
  }
  return entries;
}

await build({
  entryPoints: getEntryPoints(srcDir),
  outdir: join(dir, '..', 'dist'),
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  packages: 'external',
  jsx: 'automatic',
  loader: {
    '.md': 'text',
  },
  plugins: [mdx()],
});

console.log('Build complete');
