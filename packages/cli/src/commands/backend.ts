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
 * Load the backend module based on the configuration
 */
async function loadBackendModule(projectRootPath: string) {
  const config = loadBackendConfig(projectRootPath);
  const backendPackage = config.backend!.package;

  let backendModule: any;

  if (backendPackage.startsWith('file:')) {
    // Load from local file path
    const packagePath = backendPackage.replace('file:', '');
    const localModulePath = path.join(
      packagePath,
      'dist',
      'src',
      'node-index.js'
    );
    backendModule = await import(localModulePath);
  } else {
    // Load from npm package
    backendModule = await import(backendPackage);
  }

  return backendModule;
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
