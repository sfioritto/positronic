import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    // Ensure Vitest uses the Cloudflare pool
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        // Vitest pool options override wrangler.toml
        wrangler: { configPath: './wrangler.toml' },
        // Optionally configure miniflare options
        miniflare: {
          // We might need this if tests interact with external services
           liveReload: false,
        },
      },
    },
    // Optional: Setup files, globals, etc.
    // setupFiles: ['./test/setup.ts'],
    globals: true, // If you want describe, it, expect etc. globally available
  },
});