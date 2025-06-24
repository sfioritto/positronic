/**
 * @positronic/spec
 *
 * This package contains:
 * - Interface specifications for Positronic implementations
 * - Conformance test suites
 * - Shared types and contracts
 *
 * Currently includes the PositronicDevServer interface.
 * Future additions will include REST API specifications and tests.
 */

import type { ChildProcess } from 'child_process';

/**
 * Development server interface for Positronic backends
 *
 * This interface is used by the Positronic CLI to manage local development servers.
 */
export interface PositronicDevServer {
  /**
   * Setup the development environment (e.g., create .positronic directory)
   * This is called once when setting up a project or when --force is used
   * @param projectRoot The root path of the Positronic project
   * @param force Force regeneration even if environment exists
   */
  setup(projectRoot: string, force?: boolean): Promise<void>;

  /**
   * Start the development server
   * @param projectRoot The root path of the Positronic project
   * @param port Optional port number
   * @returns The child process running the server
   */
  start(projectRoot: string, port?: number): Promise<ChildProcess>;

  /**
   * Optional: Watch for brain file changes and handle them
   * This is called by the CLI when brain files (*.ts in brains/) change
   * @param projectRoot The root path of the Positronic project
   * @param filePath The path to the brain file that changed
   * @param event The type of change that occurred
   */
  watch?(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void>;

  /**
   * Optional: Deploy to the backend's hosting service
   * @param projectRoot The root path of the Positronic project
   * @param config Deployment configuration
   */
  deploy?(projectRoot: string, config?: any): Promise<void>;
}

export { testStatus, resources } from './api.js';
