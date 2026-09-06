/**
 * Vite configuration for the generated-page bundle.
 *
 * Bundles .positronic/bundle.ts, React included, into a single script the
 * browser loads as /bundle/components.js. Mirrors the dev server's build.
 *
 * Run: npm run build:components
 * Or let the dev server build it automatically.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  // Library mode leaves process.env.NODE_ENV in the output for a downstream
  // bundler to resolve. There is none here: the script runs in the browser as
  // is. Without this define React's development build ships and the page
  // throws "process is not defined".
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '.positronic/dist',
    // components.css from the Tailwind CLI lives in the same directory.
    emptyOutDir: false,
    lib: {
      entry: '.positronic/bundle.ts',
      formats: ['iife'],
      // Required by Vite for iife output; bundle.ts has no exports, so it
      // never appears in the output.
      name: 'PositronicPage',
      fileName: () => 'components.js',
    },
  },
});
