/**
 * Vite configuration for the generated-page bundle.
 *
 * Bundles .positronic/bundle.ts, React included, into a single script the
 * browser loads as /bundle/components.js, and compiles the stylesheet it
 * imports (.positronic/styles.css, Tailwind) into /bundle/components.css.
 * The dev server runs this config on startup and whenever a file under
 * src/components/ changes, then uploads both outputs to R2 as /bundle/*.
 * `npm run build:components` runs it by hand.
 */
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  // Library mode leaves process.env.NODE_ENV in the output for a downstream
  // bundler to resolve. There is none here: the script runs in the browser as
  // is. Without this define React's development build ships and the page
  // throws "process is not defined".
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '.positronic/dist',
    lib: {
      entry: '.positronic/bundle.ts',
      formats: ['iife'],
      // Required by Vite for iife output; bundle.ts has no exports, so it
      // never appears in the output.
      name: 'PositronicPage',
      fileName: () => 'components.js',
      // Must stay 'components': generatePageHtml
      // (packages/core/src/page/page-html.ts) links the stylesheet at
      // /bundle/components.css. With a function fileName, Vite would
      // otherwise name the CSS after the package.
      cssFileName: 'components',
    },
  },
});
