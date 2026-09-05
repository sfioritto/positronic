import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// The cloudflare package source lives outside this project's root, so the
// coverage include pattern has to be absolute (allowExternal matches on
// absolute paths, not paths relative to root).
const cloudflareSrc = fileURLToPath(new URL('../src', import.meta.url));
// The spec package is the API contract. Including it here means a spec
// function at 0% is a contract no backend test enforces.
const specSrc = fileURLToPath(new URL('../../spec/src', import.meta.url));

export default defineWorkersConfig({
  // Load the spec package from source so coverage lands on its .ts files
  // rather than the compiled dist the package entry points at.
  resolve: {
    alias: { '@positronic/spec': `${specSrc}/index.ts` },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // Reverted: Removed explicit miniflare block
      },
    },
    coverage: {
      // The workers pool does not support V8 coverage; Istanbul is required.
      // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
      provider: 'istanbul',
      allowExternal: true,
      include: [`${cloudflareSrc}/**/*.ts`, `${specSrc}/**/*.ts`],
      exclude: [`${cloudflareSrc}/**/*.d.ts`, `${specSrc}/**/*.d.ts`],
      reporter: ['text', 'lcov'],
    },
  },
});
