import { render } from 'ink-testing-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import process from 'process';
import type { TestServerHandle } from '../test/test-dev-server.js';
import { TestDevServer } from '../test/test-dev-server.js';
import { buildCli } from '../cli.js';
import type { PositronicDevServer } from '@positronic/spec';
import caz from 'caz';

// Helper function to copy test resources from test data directory
function copyTestResources(targetDir: string) {
  const testDataPath = path.join(__dirname, '../test/data/resources');
  const targetResourcesPath = path.join(targetDir, 'resources');

  // Remove existing resources directory if it exists
  if (fs.existsSync(targetResourcesPath)) {
    fs.rmSync(targetResourcesPath, { recursive: true, force: true });
  }

  // Copy the test data resources
  fs.cpSync(testDataPath, targetResourcesPath, { recursive: true });
}

// Helper function to create a minimal Positronic project structure
async function createMinimalProject(
  dir: string,
  projectName: string = 'test-project'
) {
  // Determine template path - use local development path if available
  const devPath = process.env.POSITRONIC_LOCAL_PATH;
  let templatePath = '@positronic/template-new-project';

  if (devPath) {
    templatePath = path.resolve(devPath, 'packages', 'template-new-project');
  }

  // Generate project using caz with 'none' backend (core only)
  await caz.default(templatePath, dir, {
    name: projectName,
    backend: 'none',
    install: false,
    force: true,
  });

  // Copy some test resources that can be used for testing
  copyTestResources(dir);
}

class TestEnv {
  private serverHandle: TestServerHandle | null = null;
  constructor(private testServer: TestDevServer) {}
  get projectRootDir() {
    return this.testServer.projectRootDir;
  }

  setup(setup: (tempDir: string) => void | Promise<void>) {
    setup(this.projectRootDir);
    return this;
  }

  async start() {
    if (this.serverHandle) {
      throw new Error('Server already started');
    }
    this.serverHandle = await this.testServer.start();
    return (argv: string[]) => {
      if (!this.serverHandle) {
        throw new Error('Server not started');
      }
      return px(argv, {
        server: this.testServer,
      });
    };
  }

  cleanup() {
    fs.rmSync(this.projectRootDir, { recursive: true, force: true });
  }

  async stop() {
    if (!this.serverHandle) {
      throw new Error('Server not started');
    }
    this.serverHandle.kill();
    this.serverHandle = null;
    await this.testServer.stop();
  }

  async stopAndCleanup() {
    await this.stop();
    this.cleanup();
  }
}

export async function createTestEnv(): Promise<TestEnv> {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-server-test-')
  );
  await createMinimalProject(tempDir);

  // Create test dev server instance
  const devServer = new TestDevServer(tempDir);

  return new TestEnv(devServer);
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
export async function px(
  argv: string[],
  options: {
    server?: PositronicDevServer;
    configDir?: string;
  } = {}
) {
  let capturedElement: React.ReactElement | null = null;

  const mockRenderFn = (element: React.ReactElement) => {
    capturedElement = element;
  };

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
  }
}
