import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(dir, '..', 'src');
const distDir = join(dir, '..', 'dist');

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
