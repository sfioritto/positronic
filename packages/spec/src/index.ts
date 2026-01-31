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

/**
 * Handle for managing a running development server
 *
 * This interface provides lifecycle management for a server instance,
 * abstracting away the underlying implementation details (process, worker, etc.)
 */
export interface ServerHandle {
  /**
   * Register a callback to be called when the server closes
   * @param callback Function called with exit code when server terminates
   */
  onClose(callback: (code?: number | null) => void): void;

  /**
   * Register a callback to be called when the server encounters an error
   * @param callback Function called with error details
   */
  onError(callback: (error: Error) => void): void;

  /**
   * Stop the server
   * @param signal Optional signal to send (e.g., 'SIGTERM', 'SIGKILL')
   * @returns true if the kill signal was sent successfully
   */
  kill(signal?: string): boolean;

  /**
   * Whether the server has been killed
   */
  readonly killed: boolean;

  /**
   * Wait until the server is ready to accept requests
   * @param maxWaitMs Maximum time to wait in milliseconds
   * @returns true if server is ready, false if timeout reached
   */
  waitUntilReady(maxWaitMs?: number): Promise<boolean>;
}

/**
 * Development server interface for Positronic backends
 *
 * This interface is used by the Positronic CLI to manage local development servers.
 */
export interface PositronicDevServer {
  /**
   * The root path of the Positronic project
   */
  readonly projectRootDir: string;

  /**
   * Setup the development environment (e.g., create .positronic directory)
   * This is called once when setting up a project or when --force is used
   * @param force Force regeneration even if environment exists
   */
  setup(force?: boolean): Promise<void>;

  /**
   * Start the development server
   * @param port Optional port number
   * @returns A handle for managing the running server
   */
  start(port?: number): Promise<ServerHandle>;

  /**
   * Optional: Watch for brain file changes and handle them
   * This is called by the CLI when brain files (*.ts in brains/) change
   * @param filePath The path to the brain file that changed
   * @param event The type of change that occurred
   */
  watch?(filePath: string, event: 'add' | 'change' | 'unlink'): Promise<void>;

  /**
   * Optional: Deploy to the backend's hosting service
   * @param config Deployment configuration
   */
  deploy(config?: any): Promise<void>;

  /**
   * Register a callback for log messages
   * @param callback Function called with log messages
   */
  onLog(callback: (message: string) => void): void;

  /**
   * Register a callback for error messages
   * @param callback Function called with error messages
   */
  onError(callback: (message: string) => void): void;

  /**
   * Register a callback for warning messages
   * @param callback Function called with warning messages
   */
  onWarning(callback: (message: string) => void): void;

  /**
   * List all secrets for the current environment
   * @returns Array of secret names with optional metadata
   */
  listSecrets?(): Promise<Array<{ name: string; createdAt?: Date; updatedAt?: Date }>>;

  /**
   * Set or update a secret
   * @param name Secret name (must be valid environment variable name)
   * @param value Secret value
   */
  setSecret?(name: string, value: string): Promise<void>;

  /**
   * Delete a secret
   * @param name Secret name
   * @returns true if deleted, false if not found
   */
  deleteSecret?(name: string): Promise<boolean>;

  /**
   * Bulk upload secrets from a .env file to the backend.
   * @param filePath Path to the .env file
   */
  bulkSecrets(filePath: string): Promise<void>;
}

export { testStatus, resources, brains, schedules, secrets, webhooks, signals, pages, bundle, auth } from './api/index.js';
export type { AuthSetupResponse } from './api/index.js';
