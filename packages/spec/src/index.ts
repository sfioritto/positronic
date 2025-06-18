/**
 * @positronic/spec
 *
 * This package contains:
 * - Interface specifications for Positronic implementations
 * - Conformance test suites
 * - Shared types and contracts
 *
 * Currently includes the PositronicDevServer and PositronicWatcher interfaces.
 * Future additions will include REST API specifications and tests.
 */

import type { ChildProcess } from 'child_process';

/**
 * File watcher interface for Positronic backends
 *
 * This interface handles file change events. The CLI manages the actual
 * file watching and calls these methods when changes are detected.
 */
export interface PositronicWatcher {
  /**
   * Called when a brain file (*.ts in brains/) is added, changed, or removed
   * @param projectRoot The root path of the Positronic project
   * @param filePath The path to the brain file that changed
   * @param event The type of change that occurred
   */
  onBrainChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void>;

  /**
   * Called when a resource file (in resources/) is added, changed, or removed
   * @param projectRoot The root path of the Positronic project
   * @param filePath The path to the resource file that changed
   * @param event The type of change that occurred
   */
  onResourceChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void>;
}

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
   * Optional: Deploy to the backend's hosting service
   * @param projectRoot The root path of the Positronic project
   * @param config Deployment configuration
   */
  deploy?(projectRoot: string, config?: any): Promise<void>;
}
