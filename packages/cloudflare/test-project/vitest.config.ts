import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
// The spec package is the API contract. Including it here means a spec
// function at 0% is a contract no backend test enforces.
const specSrc = join(here, '../../spec/src');

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  // Load the spec package from source so coverage lands on its .ts files
  // rather than the compiled dist the package entry points at.
  resolve: {
    alias: { '@positronic/spec': `${specSrc}/index.ts` },
  },
  test: {
    coverage: {
      // The workers plugin does not support V8 coverage; Istanbul is required.
      // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
      provider: 'istanbul',
      // The cloudflare package source lives outside this project's root.
      // The include glob is root-relative on purpose: Vitest instruments every
      // included file no test loaded, and under the workers plugin that
      // transform crashes for files outside the root. External .ts files are
      // reported once a test loads them, and src/index.ts pulls in nearly all
      // of them. Without the glob nothing external is reported at all.
      allowExternal: true,
      include: ['**/*.ts'],
      exclude: [`${here}/src/**`, `${here}/tests/**`, `${here}/webhooks/**`],
      reporter: ['text', 'lcov'],
    },
  },
});
