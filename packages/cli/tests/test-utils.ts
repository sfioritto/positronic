import React, { act } from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import process from 'process';
import type { TestServerHandle } from './test-dev-server.js';
import { TestDevServer } from './test-dev-server.js';
import { buildCli } from '../src/cli.js';
import type { PositronicDevServer } from '@positronic/spec';
import { scaffoldProject } from '@positronic/template-new-project';
import {
  resetJwtAuthProvider,
  setAuthProjectRootPath,
} from '../src/lib/jwt-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to copy test resources from test data directory
function copyTestResources(targetDir: string) {
  const testDataPath = path.join(__dirname, './data/resources');
  const targetResourcesPath = path.join(targetDir, 'resources');

  // Remove existing resources directory if it exists
  if (fs.existsSync(targetResourcesPath)) {
    fs.rmSync(targetResourcesPath, { recursive: true, force: true });
  }

  // Copy the test data resources
  fs.cpSync(testDataPath, targetResourcesPath, { recursive: true });
}

// Helper function to create a minimal Positronic project structure
export async function createMinimalProject(dir: string) {
  scaffoldProject({
    name: 'test-project',
    dest: dir,
    backend: 'none',
    claudeMd: false,
  });
  copyTestResources(dir);
  // Update positronic.config.json with the correct project name if it exists
  const configPath = path.join(dir, 'positronic.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.name = 'test-project';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}

export class TestEnv {
  private serverHandle: TestServerHandle | null = null;
  constructor(public server: TestDevServer) {}
  get projectRootDir() {
    return this.server.projectRootDir;
  }

  setup(setup: (tempDir: string) => void | Promise<void>) {
    setup(this.projectRootDir);
    return this;
  }

  async start() {
    if (this.serverHandle) {
      throw new Error('Server already started');
    }
    this.serverHandle = await this.server.start();
    return async (argv: string[]) => {
      if (!this.serverHandle) {
        throw new Error('Server not started');
      }
      return px(argv, {
        server: this.server,
        projectRootDir: this.projectRootDir,
        configDir: this.projectRootDir,
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
    await this.server.stop();
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

interface PxResult {
  waitForOutput: (regex?: RegExp, maxTries?: number) => Promise<boolean>;
  waitForTypesFile: (types: string | string[]) => Promise<string>;
  instance: {
    lastFrame: () => string | undefined;
    unmount: () => void;
    frames: string[];
    stdin: {
      write: (data: string) => void;
    };
  };
}

export async function px(
  argv: string[],
  options: {
    server?: PositronicDevServer;
    projectRootDir?: string;
    configDir?: string;
    skipAuthSetup?: boolean;
  } = {}
): Promise<PxResult> {
  const { server, projectRootDir, configDir, skipAuthSetup } = options;
  let instance: ReturnType<typeof render> | null = null;
  instance = await runCli(argv, {
    server,
    configDir,
    skipAuthSetup,
    projectRootPath: projectRootDir,
  });

  // Ink writes a bare newline when the app unmounts in the non-interactive
  // debug mode ink-testing-library renders with. That write is not a frame.
  const lastFrame = () => {
    const frames = instance?.frames ?? [];
    const last = frames.at(-1);
    return last === '\n' ? frames.at(-2) : last;
  };

  return {
    waitForOutput: async (regex?: RegExp, maxTries = 10) => {
      if (!instance && !regex) {
        return true;
      }
      if (!instance && regex) {
        console.error('waitForOutput failed, instance is null');
        return false;
      }

      let tries = 0;
      while (tries < maxTries) {
        if (regex!.test(lastFrame() ?? '')) {
          // The frame is written during commit; the effects of that render
          // (Ink's input subscriptions among them) run on the next task.
          // Yield once so a stdin.write right after this call is received.
          await new Promise((resolve) => setImmediate(resolve));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        tries++;
      }
      console.error('waitForOutput failed, last frame:', lastFrame());
      return false;
    },
    waitForTypesFile: async (types: string | string[]) => {
      if (projectRootDir) {
        const typesPath = path.join(projectRootDir, 'resources.d.ts');
        return waitForTypesFile(typesPath, types, 1000);
      }
      console.warn(
        "waitForTypesFile didn't wait for anything, projectRootDir is not set"
      );
      return '';
    },
    instance: instance
      ? {
          lastFrame,
          unmount: instance.unmount,
          frames: instance.frames,
          stdin: instance.stdin,
        }
      : {
          lastFrame: () => undefined,
          unmount: () => {},
          frames: [],
          stdin: { write: () => {} },
        },
  };
}

// Helper function to test CLI commands with ink-testing-library
async function runCli(
  argv: string[],
  options: {
    server?: PositronicDevServer;
    configDir?: string;
    skipAuthSetup?: boolean;
    projectRootPath?: string;
  } = {}
): Promise<ReturnType<typeof render> | null> {
  let capturedElement: ReturnType<typeof render> | null = null;
  const { configDir, server, skipAuthSetup, projectRootPath } = options;
  const mockRenderFn = (element: React.ReactElement) => {
    capturedElement = render(element);
    return capturedElement;
  };

  // Setup project-specific environment if configDir is provided
  if (configDir) {
    process.env.POSITRONIC_CONFIG_DIR = configDir;
  }

  // Use a non-existent key path to prevent auth from trying to use real SSH keys
  // This ensures tests don't accidentally try to connect to ssh-agent
  // Only set if not already configured (allows auth.test.ts to override)
  // Skip entirely if skipAuthSetup is true (for auth tests that test global config)
  if (!skipAuthSetup && !process.env.POSITRONIC_PRIVATE_KEY) {
    process.env.POSITRONIC_PRIVATE_KEY = '/nonexistent/test-key';
  }
  // Set project root path for local auth resolution
  setAuthProjectRootPath(projectRootPath || null);

  // Always reset provider to pick up current env variable
  resetJwtAuthProvider();

  // Note: We don't delete POSITRONIC_CONFIG_DIR after because React components
  // may use it asynchronously in useEffect hooks
  const testCli = buildCli({
    argv,
    server,
    exitProcess: false,
    render: mockRenderFn,
    projectRootPath,
  });

  // act() flushes the effects of the initial render before returning, so the
  // first frame a test reads is the one after data loading and exit handling.
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const wasActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      await testCli.parse();
    });
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  }

  return capturedElement;
}
