import { build } from 'esbuild';
import mdx from '@mdx-js/esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(dir, '..', 'src', 'index.ts')],
  outdir: join(dir, '..', 'dist'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  packages: 'external',
  jsx: 'automatic',
  loader: { '.md': 'text' },
  plugins: [mdx()],
});
