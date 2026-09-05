/**
 * esbuild configuration for the generated-page bundle.
 *
 * Bundles .positronic/bundle.ts, React included, into a single script the
 * browser loads as /bundle/components.js. Mirrors the dev server's build.
 *
 * Run: npm run build:components
 * Or let the dev server build it automatically.
 */
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['.positronic/bundle.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  minify: true,
  outfile: '.positronic/dist/components.js',
});
