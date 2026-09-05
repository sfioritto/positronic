import * as fs from 'fs';
import * as path from 'path';
import type { PositronicDevServer } from '@positronic/spec';

interface BackendConfig {
  type: string;
  package: string;
}

interface PositronicConfig {
  backend?: BackendConfig;
}

/**
 * Load the backend configuration from positronic.config.json
 */
function loadBackendConfig(projectRootPath: string): PositronicConfig {
  const configPath = path.join(projectRootPath, 'positronic.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (!config.backend) {
    throw new Error('No backend configuration found in positronic.config.json');
  }

  return config;
}

/**
 * Load the backend module based on the configuration. The package is either
 * a `file:` path to a local checkout or a package name resolved from the
 * project's node_modules; both expose the Node entry point at the same spot.
 */
async function loadBackendModule(projectRootPath: string) {
  const config = loadBackendConfig(projectRootPath);
  const backendPackage = config.backend!.package;

  const packageRoot = backendPackage.startsWith('file:')
    ? backendPackage.replace('file:', '')
    : path.join(projectRootPath, 'node_modules', backendPackage);

  return import(path.join(packageRoot, 'dist', 'node-index.js'));
}

/**
 * Create a dev server instance from the backend configuration
 */
export async function createDevServer(
  projectRootPath: string
): Promise<PositronicDevServer> {
  const { DevServer } = await loadBackendModule(projectRootPath);
  return new DevServer(projectRootPath);
}
