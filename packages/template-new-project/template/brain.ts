import { brain as coreBrain, type BrainFunction } from '@positronic/core';

/**
 * Base brain factory for this project.
 * 
 * This wrapper allows you to configure services once and have them available
 * in all brains throughout your project.
 * 
 * To add services:
 * 1. Define your service interfaces
 * 2. Create service instances
 * 3. Call .withServices() on the brain before returning it
 * 
 * Example with services and options:
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
 * export const brain: BrainFunction = (brainConfig) => {
 *   return coreBrain(brainConfig)
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
 * 
 * export default brain('My Brain')
 *   .withOptions({
 *     environment: 'production',
 *     verbose: false
 *   })
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
export const brain: BrainFunction = (brainConfig) => {
  // For now, just return the core brain without any services.
  // Update this function to add your project-wide services.
  return coreBrain(brainConfig);
};