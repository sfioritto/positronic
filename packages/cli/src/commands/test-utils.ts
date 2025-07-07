import { render } from 'ink-testing-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import process from 'process';
import type { TestServerHandle } from '../test/test-dev-server.js';
import { TestDevServer } from '../test/test-dev-server.js';
import { buildCli } from '../cli.js';
import type { PositronicDevServer } from '@positronic/spec';

// Helper function to create a minimal Positronic project structure
function createMinimalProject(dir: string, config?: any) {
  const defaultConfig = {
    name: 'test-project',
    version: '1.0.0',
  };

  fs.writeFileSync(
    path.join(dir, 'positronic.config.json'),
    JSON.stringify({ ...defaultConfig, ...config }, null, 2)
  );

  fs.mkdirSync(path.join(dir, 'brains'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });

  // Create default resources
  fs.writeFileSync(
    path.join(dir, 'resources', 'test.txt'),
    'Default test resource'
  );
  fs.writeFileSync(
    path.join(dir, 'resources', 'data.json'),
    '{"default": true}'
  );
}

export async function createTestEnv(): Promise<TestDevServer> {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-server-test-')
  );

  let serverHandle: TestServerHandle | null = null;

  const cleanup = async () => {
    if (serverHandle && !serverHandle.killed) {
      serverHandle.kill();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    createMinimalProject(tempDir);

    // Run setup callback if provided
    if (setup) {
      await setup(tempDir);
    }

    // Create test dev server instance
    const devServer = new TestDevServer(tempDir);

    // Setup the dev server
    await devServer.setup();

    // Start the dev server
    serverHandle = await devServer.start();

    const port = devServer.port;
    // Set environment variables for test mode
    process.env.POSITRONIC_TEST_MODE = 'true';
    process.env.POSITRONIC_SERVER_PORT = port.toString();

    // Wait for server to be ready
    const isReady = await serverHandle.waitUntilReady();

    if (!isReady) {
      throw new Error(`Server failed to start on port ${port}`);
    }

    return devServer;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// Helper function to copy test resources from test data directory
export function copyTestResources(targetDir: string) {
  const testDataPath = path.join(__dirname, '../test/data/resources');
  const targetResourcesPath = path.join(targetDir, 'resources');

  // Remove existing resources directory if it exists
  if (fs.existsSync(targetResourcesPath)) {
    fs.rmSync(targetResourcesPath, { recursive: true, force: true });
  }

  // Copy the test data resources
  fs.cpSync(testDataPath, targetResourcesPath, { recursive: true });
}

// Helper function to wait for types file to contain specific content
export async function waitForTypesFile(
  typesPath: string,
  expectedContent: string | string[],
  maxWaitMs = 5000
): Promise<string> {
  const startTime = Date.now();
  const contentToCheck = Array.isArray(expectedContent)
    ? expectedContent
    : [expectedContent];

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(typesPath)) {
      const content = fs.readFileSync(typesPath, 'utf-8');
      // Check if all expected content is present
      if (contentToCheck.every((expected) => content.includes(expected))) {
        return content;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return '';
}

// Helper function to test CLI commands with ink-testing-library
export async function testCliCommand(
  argv: string[],
  options: {
    server?: PositronicDevServer;
    configDir?: string;
    setupEnv?: () => void;
    cleanupEnv?: () => void;
  } = {}
) {
  let capturedElement: React.ReactElement | null = null;

  const mockRenderFn = (element: React.ReactElement) => {
    capturedElement = element;
  };

  // Setup environment if provided
  options.setupEnv?.();

  // Setup project-specific environment if configDir is provided
  if (options.configDir) {
    process.env.POSITRONIC_CONFIG_DIR = options.configDir;
    process.env.POSITRONIC_TEST_MODE = 'true';
  }

  try {
    const testCli = buildCli({
      argv,
      server: options.server,
      exitProcess: false,
      render: mockRenderFn,
    });

    await testCli.parse();

    return capturedElement;
  } finally {
    // Cleanup project-specific environment if configDir was provided
    if (options.configDir) {
      delete process.env.POSITRONIC_CONFIG_DIR;
      delete process.env.POSITRONIC_TEST_MODE;
    }

    // Cleanup environment if provided
    options.cleanupEnv?.();
  }
}
