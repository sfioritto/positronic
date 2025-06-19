import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import process from 'process';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fileURLToPath } from 'url';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

describe('CLI Integration: positronic server', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-server-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Project validation', () => {
    it('should not have server command available outside a Positronic project', () => {
      // Run server command in a directory that is NOT a Positronic project
      let stderr: string = '';
      let exitCode: number = 0;

      try {
        execSync(`${nodeExecutable} ${cliExecutable} server`, {
          cwd: tempDir, // Empty directory, no positronic.config.json
          stdio: 'pipe',
          encoding: 'utf8',
          env: {
            ...process.env,
            POSITRONIC_TEST_MODE: 'true',
          },
        });
      } catch (error: any) {
        stderr = error.stderr || '';
        exitCode = error.status || 1;
      }

      // The server command should not be recognized outside a project
      // Yargs will show an error about unknown command
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command: server');

      // Additionally, if we check help, server command should not be listed
      const helpOutput = execSync(`${nodeExecutable} ${cliExecutable} --help`, {
        cwd: tempDir,
        stdio: 'pipe',
        encoding: 'utf8',
        env: {
          ...process.env,
        },
      });

      expect(helpOutput).not.toContain('server');
      expect(helpOutput).not.toContain('Start the local development server');
    });
  });
});
