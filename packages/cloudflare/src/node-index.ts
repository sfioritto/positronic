/**
 * Node.js-compatible exports from @positronic/cloudflare
 * This file is used when importing from Node.js environments (like the CLI)
 * and excludes any Cloudflare Workers-specific modules.
 */

// Only export modules that don't depend on cloudflare:workers
export { PositronicManifest } from './manifest.js';
export { CloudflareR2Loader } from './r2-loader.js';
export { createResources } from '@positronic/core';
export { CloudflareDevServer } from './dev-server.js';

// Note: We do NOT export BrainRunnerDO, MonitorDO, or api here
// because they depend on cloudflare:workers runtime

// TODO: When CloudflareDevServer is implemented, add:
// export { CloudflareDevServer } from './dev-server.js';
