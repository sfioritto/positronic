/**
 * esbuild configuration for bundling UI components.
 *
 * This bundles the components from .positronic/bundle.ts into a single
 * JavaScript file that can be served to the browser.
 *
 * Run: npm run build:components
 * Or let the dev server build it automatically.
 */
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['.positronic/bundle.ts'],
  bundle: true,
  external: ['react', 'react-dom'],
  format: 'iife',
  outfile: '.positronic/dist/components.js',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  tsconfigRaw: {
    compilerOptions: {
      jsx: 'react',
    },
  },
});
