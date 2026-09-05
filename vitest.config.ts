import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// Paths that must never be picked up as tests by any project.
const ignored = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.test-cache/**',
  'packages/cloudflare/test-project/**',
  'packages/template-new-project/template/**',
];

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their source so tests run without a
    // build step and coverage lands on .ts files rather than dist.
    alias: [
      {
        find: /^@positronic\/([^/]+)$/,
        replacement: `${root}packages/$1/src`,
      },
    ],
  },
  test: {
    // Node gives a default import of a CommonJS package the whole
    // module.exports object, and the CLI relies on that shape (it calls
    // caz.default). Vitest flattens it by default; keep Node semantics so
    // tests see what production sees.
    deps: { interopDefault: false },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Report every source file, not only the ones tests happen to import.
      // The spec package is contract tests, not source; the cloudflare vitest
      // suite in test-project reports it. Worker-side cloudflare source is
      // reported there too, so only the Node-side entry points are listed
      // here.
      include: [
        'packages/core/src/**/*.{ts,tsx}',
        'packages/cli/src/**/*.{ts,tsx}',
        'packages/client-vercel/src/**/*.{ts,tsx}',
        'packages/gen-ui-components/src/**/*.{ts,tsx}',
        'packages/mem0/src/**/*.{ts,tsx}',
        'packages/cloudflare/src/dev-server.ts',
        'packages/cloudflare/src/node-index.ts',
      ],
      exclude: ['**/*.d.ts'],
    },
    projects: [
      {
        // CLI package tests, with the nock network safety net. Excludes
        // server.test.ts, which tests the server command itself.
        extends: true,
        test: {
          name: 'cli',
          include: ['packages/cli/**/*.test.ts'],
          exclude: [...ignored, 'packages/cli/tests/server.test.ts'],
          setupFiles: ['packages/cli/tests/vitest.setup.ts'],
          globalSetup: ['packages/cli/tests/global-setup.ts'],
        },
      },
      {
        // CLI server tests, no nock setup.
        extends: true,
        test: {
          name: 'cli-server',
          include: ['packages/cli/tests/server.test.ts'],
          exclude: ignored,
          globalSetup: ['packages/cli/tests/global-setup.ts'],
        },
      },
      {
        // Everything else.
        extends: true,
        test: {
          name: 'other',
          include: ['packages/**/*.test.ts'],
          exclude: [...ignored, 'packages/cli/**'],
        },
      },
    ],
  },
});
