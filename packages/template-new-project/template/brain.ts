import { brain as coreBrain, type Brain } from '@positronic/core';

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
 * Example:
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
 * export function brain<TOptions extends object = object, TState extends object = object>(
 *   brainConfig: string | { title: string; description?: string }
 * ) {
 *   return coreBrain<TOptions, TState, ProjectServices>(brainConfig)
 *     .withServices({
 *       logger: {
 *         info: (msg) => console.log(`[INFO] ${msg}`),
 *         error: (msg) => console.error(`[ERROR] ${msg}`)
 *       },
 *       api: {
 *         fetch: async (endpoint) => {
 *           const response = await fetch(`https://api.example.com${endpoint}`);
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
 *   .step('Use Services', async ({ logger, api }) => {
 *     logger.info('Fetching data...');
 *     const data = await api.fetch('/users');
 *     return { users: data };
 *   });
 * ```
 */
export function brain<
  TOptions extends object = object,
  TState extends object = object
>(
  brainConfig: string | { title: string; description?: string }
): Brain<TOptions, TState, object> {
  // For now, just return the core brain without any services.
  // Update this function to add your project-wide services.
  return coreBrain<TOptions, TState, object>(brainConfig);
}