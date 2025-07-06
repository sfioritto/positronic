/**
 * CLI Integration Tests - Testing Philosophy
 *
 * These tests are designed to be maintainable and resilient to UI changes.
 *
 * Key principles:
 * 1. **Test behavior, not formatting** - Don't check for specific icons, emojis, or exact formatting
 * 2. **Look for essential keywords only** - Focus on the minimum text that indicates success/failure
 * 3. **Use simple assertions** - Prefer toContain() over complex regex when possible
 * 4. **Be case-insensitive** - Use toLowerCase() to avoid breaking on capitalization changes
 *
 * Examples:
 * - For success: look for "added", "switched", etc. (not specific success emojis)
 * - For errors: look for "not found", "invalid", "already exists" (not error icons)
 * - For data: check that project names and URLs appear, but not their exact formatting
 *
 * This approach ensures tests remain stable as the CLI's output formatting evolves,
 * while still verifying that core functionality works correctly.
 */

// Import nock to use in tests, but configuration happens in jest.setup.js

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterEach } from '@jest/globals';
import { createTestServer, testCliCommand } from './test-utils.js';
import type { MethodCall, TestDevServer } from '../test/test-dev-server.js';
import React from 'react';

describe('CLI Integration: positronic server with project', () => {
  let server: TestDevServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('should call dev server setup() and start() methods correctly', async () => {
    // Create a test server
    server = await createTestServer();

    // Fetch the method call logs
    const methodCalls = server.getLogs();

    // Verify setup() was called
    const setupCall = methodCalls.find(
      (call: MethodCall) => call.method === 'setup'
    );
    expect(setupCall).toBeDefined();

    expect(setupCall!.args[0]).toBe(undefined); // force flag

    // Verify start() was called
    const startCall = methodCalls.find(
      (call: MethodCall) => call.method === 'start'
    );
    expect(startCall).toBeDefined();
  });

  it('runs a brain', async () => {
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

    const { output } = await testCliCommand(['run', 'test-brain'], {
      server,
    });

    console.log('CLI output:', output);

    // Verify the run command connected to the server and got a run ID
    expect(output).toContain('Run ID:');
    expect(output).toContain('run-');
  });
});

describe('CLI Integration: project commands', () => {
  let tempDir: string;
  let configDir: string;
  let px: (
    argv: string[]
  ) => Promise<{ output: string; element: React.ReactElement | null }>;

  beforeEach(() => {
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-project-test-')
    );
    configDir = path.join(tempDir, '.positronic');

    // Create px wrapper that captures configDir
    px = (argv: string[]) => testCliCommand(argv, { configDir });
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('project add', () => {
    it('should add a new project successfully', async () => {
      const { output } = await px([
        'project',
        'add',
        'My App',
        '--url',
        'https://my-app.positronic.sh',
      ]);

      expect(output.toLowerCase()).toContain('added');
      expect(output).toMatch(/my app/i);
      expect(output).toContain('https://my-app.positronic.sh');

      // Verify config file was created
      const configPath = path.join(configDir, 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.projects).toHaveLength(1);
      expect(config.projects[0].name).toBe('My App');
      expect(config.currentProject).toBe('My App');
    });

    it('should reject duplicate project names', async () => {
      // Add first project
      await px([
        'project',
        'add',
        'My App',
        '--url',
        'https://my-app.positronic.sh',
      ]);

      // Try to add duplicate
      const { output } = await px([
        'project',
        'add',
        'My App',
        '--url',
        'https://other.positronic.sh',
      ]);

      expect(output.toLowerCase()).toContain('already exists');
    });

    it('should reject invalid URLs', async () => {
      const { output } = await px([
        'project',
        'add',
        'My App',
        '--url',
        'not-a-valid-url',
      ]);

      expect(output.toLowerCase()).toContain('invalid');
    });

    it('should handle project names with spaces', async () => {
      const { output } = await px([
        'project',
        'add',
        'My Production App',
        '--url',
        'https://prod.positronic.sh',
      ]);

      expect(output.toLowerCase()).toContain('added');
      expect(output).toMatch(/my production app/i);

      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.projects[0].name).toBe('My Production App');
    });
  });

  describe('project list', () => {
    it('should show empty state when no projects configured', async () => {
      const { output } = await px(['project', 'list']);

      expect(output.toLowerCase()).toContain('no projects');
    });

    it('should list all projects with current indicator', async () => {
      // Add some projects
      await px([
        'project',
        'add',
        'Project One',
        '--url',
        'https://one.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Project Two',
        '--url',
        'https://two.positronic.sh',
      ]);
      await px(['project', 'select', 'Project Two']);

      const { output } = await px(['project', 'list']);

      expect(output).toMatch(/project one/i);
      expect(output).toMatch(/project two/i);
    });
  });

  describe('project select', () => {
    beforeEach(async () => {
      // Add some projects for selection tests
      await px([
        'project',
        'add',
        'Project Alpha',
        '--url',
        'https://alpha.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Project Beta',
        '--url',
        'https://beta.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Project Gamma',
        '--url',
        'https://gamma.positronic.sh',
      ]);
    });

    it('should select a project by name', async () => {
      const { output } = await px(['project', 'select', 'Project Beta']);

      expect(output.toLowerCase()).toMatch(/switched|selected/);
      expect(output).toMatch(/project beta/i);

      // Verify config was updated
      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.currentProject).toBe('Project Beta');
    });

    it('should show error for non-existent project', async () => {
      const { output } = await px(['project', 'select', 'Non Existent']);

      expect(output.toLowerCase()).toContain('not found');
      expect(output).toMatch(/project alpha/i);
    });

    it('should show interactive selection when no name provided', async () => {
      const { output } = await px(['project', 'select']);

      // In test environment, raw mode isn't supported so it shows a non-interactive list
      expect(output).toMatch(/project alpha/i);
      expect(output).toMatch(/project beta/i);
      expect(output).toMatch(/project gamma/i);
    });
  });

  describe('project show', () => {
    it('should show no project selected when empty', async () => {
      const { output } = await px(['project', 'show']);

      expect(output.toLowerCase()).toContain('no project');
    });

    it('should show current project details', async () => {
      await px([
        'project',
        'add',
        'My Current Project',
        '--url',
        'https://current.positronic.sh',
      ]);

      const { output } = await px(['project', 'show']);

      expect(output).toMatch(/my current project/i);
      expect(output).toContain('https://current.positronic.sh');
    });

    it('should show other projects count when multiple exist', async () => {
      await px([
        'project',
        'add',
        'Project 1',
        '--url',
        'https://one.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Project 2',
        '--url',
        'https://two.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Project 3',
        '--url',
        'https://three.positronic.sh',
      ]);

      const { output } = await px(['project', 'show']);

      expect(output.toLowerCase()).toContain('2 other');
    });
  });

  describe('project command interactions', () => {
    it('should maintain state across commands', async () => {
      // Add multiple projects
      await px([
        'project',
        'add',
        'First',
        '--url',
        'https://first.positronic.sh',
      ]);
      await px([
        'project',
        'add',
        'Second',
        '--url',
        'https://second.positronic.sh',
      ]);

      let { output } = await px(['project', 'show']);
      expect(output).toMatch(/first/i);

      // Switch projects
      await px(['project', 'select', 'Second']);

      // Verify switch worked
      ({ output } = await px(['project', 'show']));
      expect(output).toMatch(/second/i);

      // List should show second project
      ({ output } = await px(['project', 'list']));
      expect(output).toMatch(/second/i);
    });
  });
});
