import { build } from 'esbuild';
import mdx from '@mdx-js/esbuild';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(dir, '..', 'src');
const distDir = join(dir, '..', 'dist');

const mdxPlugins = [
  mdx({ mdExtensions: ['.md'], format: 'md' }),
  mdx({ mdxExtensions: ['.mdx'] }),
];

// Step 1: Build the render module (MDX → React components → HTML → markdown)
await build({
  entryPoints: [join(srcDir, 'docs', 'render.tsx')],
  outfile: join(distDir, '_render.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  packages: 'external',
  jsx: 'automatic',
  plugins: mdxPlugins,
});

// Step 2: Run it to produce the system prompt markdown
const { renderSystemPrompt } = await import(resolve(distDir, '_render.mjs'));
const systemPrompt = renderSystemPrompt('__IMPORT_PATH__');
const outputPath = join(srcDir, 'system-prompt.md');
writeFileSync(outputPath, systemPrompt);
console.log(`Generated system-prompt.md (${systemPrompt.length} chars)`);

// Step 3: Build the main entry point (imports system-prompt.md as text)
await build({
  entryPoints: [join(srcDir, 'index.ts')],
  outdir: distDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  packages: 'external',
  loader: { '.md': 'text' },
});

// Clean up the temporary render bundle
const { unlinkSync } = await import('fs');
unlinkSync(join(distDir, '_render.mjs'));
