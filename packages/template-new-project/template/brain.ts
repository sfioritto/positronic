import { brain as coreBrain, type BrainFactory } from '@positronic/core';
import { components } from './components/index.js';

/**
 * Base brain factory for this project.
 *
 * This wrapper allows you to configure services and components once and have
 * them available in all brains throughout your project.
 *
 * Components are pre-configured for UI generation (forms, inputs, etc.).
 *
 * To add services:
 * 1. Define your service interfaces
 * 2. Create service instances
 * 3. Call .withServices() on the brain before returning it
 *
 * Example with services:
 * ```typescript
 * interface ProjectServices {
 *   logger: {
 *     info: (message: string) => void;
 *     error: (message: string) => void;
 *   };
 *   api: {
 *     fetch: (endpoint: string) => Promise<any>;
 *   };
 * }
 *
 * export const brain: BrainFactory = (brainConfig) => {
 *   return coreBrain(brainConfig)
 *     .withComponents(components)
 *     .withServices({
 *       logger: {
 *         info: (msg) => console.log(`[INFO] <%= '${msg}' %>`),
 *         error: (msg) => console.error(`[ERROR] <%= '${msg}' %>`)
 *       },
 *       api: {
 *         fetch: async (endpoint) => {
 *           const response = await fetch(`https://api.example.com<%= '${endpoint}' %>`);
 *           return response.json();
 *         }
 *       }
 *     });
 * }
 * ```
 *
 * Then in your brain files (in the brains/ directory):
 * ```typescript
 * import { brain } from '../brain.js';
 * import { z } from 'zod';
 *
 * const optionsSchema = z.object({
 *   environment: z.string().default('prod'),
 *   verbose: z.string().default('false')
 * });
 *
 * export default brain('My Brain')
 *   .withOptionsSchema(optionsSchema)
 *   .step('Use Services', async ({ state, options, logger, api }) => {
 *     if (options.verbose === 'true') {
 *       logger.info('Fetching data...');
 *     }
 *     const endpoint = options.environment === 'dev' ? '/users/test' : '/users';
 *     const data = await api.fetch(endpoint);
 *     return { users: data };
 *   });
 * ```
 *
 * Run with custom options from CLI:
 * px brain run my-brain -o environment=dev -o verbose=true
 */
export const brain: BrainFactory = (brainConfig) => {
  // Components are pre-configured for UI generation (forms, inputs, etc.)
  // Add your project-wide services with .withServices() if needed
  return coreBrain(brainConfig).withComponents(components);
};