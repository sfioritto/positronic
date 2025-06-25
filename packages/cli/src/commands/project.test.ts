import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, afterEach } from '@jest/globals';
import {
  createTestServer,
  fetchLogs,
  cli,
  type TestServer,
} from './test-utils.js';
import type { MethodCall } from '../test/test-dev-server.js';

describe('CLI Integration: positronic server with project', () => {
  let server: TestServer;

  afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  it('should call dev server setup() and start() methods correctly', async () => {
    // Create a test server
    server = await createTestServer();

    // Fetch the method call logs
    const methodCalls = await fetchLogs(server.port);

    // Verify setup() was called
    const setupCall = methodCalls.find(
      (call: MethodCall) => call.method === 'setup'
    );
    expect(setupCall).toBeDefined();
    expect(fs.realpathSync(setupCall!.args[0])).toBe(
      fs.realpathSync(server.dir)
    );
    expect(setupCall!.args[1]).toBe(false); // force flag

    // Verify start() was called
    const startCall = methodCalls.find(
      (call: MethodCall) => call.method === 'start'
    );
    expect(startCall).toBeDefined();
    expect(fs.realpathSync(startCall!.args[0])).toBe(
      fs.realpathSync(server.dir)
    );
    expect(startCall!.args[1]).toBe(server.port);
  });

  it('should support running brains after server starts', async () => {
    // Create a test server with a test brain
    server = await createTestServer({
      setup: (dir: string) => {
        const brainsDir = path.join(dir, 'brains');
        fs.mkdirSync(brainsDir, { recursive: true });

        // Create a simple test brain
        fs.writeFileSync(
          path.join(brainsDir, 'test-brain.ts'),
          `
          export default function testBrain() {
            return {
              title: 'Test Brain',
              steps: [
                {
                  title: 'Test Step',
                  run: async () => {
                    return { success: true };
                  }
                }
              ]
            };
          }
          `
        );
      },
    });

    // Run a brain using the CLI
    const px = cli(server);
    const result = await px('run test-brain');

    // Should succeed (exit code 0)
    expect(result.exitCode).toBe(0);

    // Verify the run command connected to the server
    // (The actual brain execution is tested elsewhere)
    expect(result.stdout).toContain('Run ID:');
  });
});
