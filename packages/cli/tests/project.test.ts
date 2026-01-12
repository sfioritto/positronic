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
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';

describe('CLI Integration: positronic server with project', () => {
  it('runs a brain', async () => {
    const env = await createTestEnv();
    const { server } = env;

    // Add brain to mock server for search
    server.addBrain({
      filename: 'test-brain',
      title: 'Test Brain',
      description: 'A test brain for testing',
      createdAt: Date.now(),
      lastModified: Date.now(),
    });

    // Setup test brain
    env.setup((dir: string) => {
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
    });

    const px = await env.start();

    try {
      const { waitForOutput } = await px(['run', 'test-brain']);

      // Verify the run command connected to the server and got a run ID
      const outputContainsRunId = await waitForOutput(/Run ID:/);
      const outputContainsRunPrefix = await waitForOutput(/run-/);

      expect(outputContainsRunId).toBe(true);
      expect(outputContainsRunPrefix).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });
});

describe('CLI Integration: project commands', () => {
  let tempDir: string;
  let configDir: string;

  beforeEach(() => {
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-project-test-')
    );
    configDir = path.join(tempDir, '.positronic');
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('project add', () => {
    it('should add a new project successfully', async () => {
      const { waitForOutput, instance } = await px(
        ['project', 'add', 'My App', '--url', 'https://my-app.positronic.sh'],
        { configDir }
      );

      const isReady = await waitForOutput(/added/i);
      expect(isReady).toBe(true);
      const output = instance.lastFrame();
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
      const addFirstProject = await px(
        ['project', 'add', 'My App', '--url', 'https://my-app.positronic.sh'],
        { configDir }
      );

      expect(await addFirstProject.waitForOutput(/added/i)).toBe(true);

      // Try to add duplicate
      const addDuplicateProject = await px(
        ['project', 'add', 'My App', '--url', 'https://other.positronic.sh'],
        { configDir }
      );
      expect(await addDuplicateProject.waitForOutput(/already exists/i)).toBe(
        true
      );
    });

    it('should reject invalid URLs', async () => {
      const { waitForOutput } = await px(
        ['project', 'add', 'My App', '--url', 'not-a-valid-url'],
        { configDir }
      );
      expect(await waitForOutput(/invalid/i)).toBe(true);
    });

    it('should handle project names with spaces', async () => {
      const { waitForOutput, instance } = await px(
        [
          'project',
          'add',
          'My Production App',
          '--url',
          'https://prod.positronic.sh',
        ],
        { configDir }
      );
      expect(await waitForOutput(/added/i)).toBe(true);
      expect(instance.lastFrame()).toMatch(/my production app/i);

      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.projects[0].name).toBe('My Production App');
    });
  });

  describe('project list', () => {
    it('should show empty state when no projects configured', async () => {
      const { instance } = await px(['project', 'list'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('no projects');
    });

    it('should list all projects with current indicator', async () => {
      // Add some projects
      await px(
        ['project', 'add', 'Project One', '--url', 'https://one.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Project Two', '--url', 'https://two.positronic.sh'],
        { configDir }
      );
      await px(['project', 'select', 'Project Two'], { configDir });

      const { instance } = await px(['project', 'list'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output).toMatch(/project one/i);
      expect(output).toMatch(/project two/i);
    });
  });

  describe('project select', () => {
    beforeEach(async () => {
      // Add some projects for selection tests
      await px(
        [
          'project',
          'add',
          'Project Alpha',
          '--url',
          'https://alpha.positronic.sh',
        ],
        { configDir }
      );
      await px(
        [
          'project',
          'add',
          'Project Beta',
          '--url',
          'https://beta.positronic.sh',
        ],
        { configDir }
      );
      await px(
        [
          'project',
          'add',
          'Project Gamma',
          '--url',
          'https://gamma.positronic.sh',
        ],
        { configDir }
      );
    });

    it('should select a project by name', async () => {
      const { instance } = await px(['project', 'select', 'Project Beta'], {
        configDir,
      });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toMatch(/switched|selected/);
      expect(output).toMatch(/project beta/i);

      // Verify config was updated
      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.currentProject).toBe('Project Beta');
    });

    it('should show error for non-existent project', async () => {
      const { instance } = await px(['project', 'select', 'Non Existent'], {
        configDir,
      });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('not found');
      expect(output).toMatch(/project alpha/i);
    });

    it('should show interactive selection when no name provided', async () => {
      const { instance } = await px(['project', 'select'], { configDir });
      const output = instance.lastFrame() || '';

      // In test environment, raw mode isn't supported so it shows a non-interactive list
      expect(output).toMatch(/project alpha/i);
      expect(output).toMatch(/project beta/i);
      expect(output).toMatch(/project gamma/i);
    });
  });

  describe('project show', () => {
    it('should show no project selected when empty', async () => {
      const { instance } = await px(['project', 'show'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('no project');
    });

    it('should show current project details', async () => {
      await px(
        [
          'project',
          'add',
          'My Current Project',
          '--url',
          'https://current.positronic.sh',
        ],
        { configDir }
      );

      const { instance } = await px(['project', 'show'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output).toMatch(/my current project/i);
      expect(output).toContain('https://current.positronic.sh');
    });

    it('should show other projects count when multiple exist', async () => {
      await px(
        ['project', 'add', 'Project 1', '--url', 'https://one.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Project 2', '--url', 'https://two.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Project 3', '--url', 'https://three.positronic.sh'],
        { configDir }
      );

      const { instance } = await px(['project', 'show'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('2 other');
    });
  });

  describe('project rm', () => {
    beforeEach(async () => {
      // Add some projects for removal tests
      await px(
        ['project', 'add', 'Project A', '--url', 'https://a.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Project B', '--url', 'https://b.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Project C', '--url', 'https://c.positronic.sh'],
        { configDir }
      );
    });

    it('should remove a project successfully', async () => {
      const { waitForOutput, instance } = await px(
        ['project', 'rm', 'Project B'],
        {
          configDir,
        }
      );

      const isReady = await waitForOutput(/removed successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output).toMatch(/project b/i);

      // Verify project was removed from config
      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.projects).toHaveLength(2);
      expect(
        config.projects.find((p: any) => p.name === 'Project B')
      ).toBeUndefined();
    });

    it('should handle removing the current project', async () => {
      // Select Project B as current
      await px(['project', 'select', 'Project B'], { configDir });

      // Remove the current project
      const { waitForOutput, instance } = await px(
        ['project', 'rm', 'Project B'],
        {
          configDir,
        }
      );

      const isReady = await waitForOutput(/removed successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output).toMatch(/project b/i);

      // Verify current project was switched to another project
      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.currentProject).not.toBe('Project B');
      expect(config.currentProject).toBeTruthy(); // Should be either Project A or Project C
    });

    it('should handle removing the last project', async () => {
      // Remove all but one project
      await px(['project', 'rm', 'Project A'], { configDir });
      await px(['project', 'rm', 'Project B'], { configDir });

      // Remove the last project
      const { waitForOutput, instance } = await px(
        ['project', 'rm', 'Project C'],
        {
          configDir,
        }
      );

      const isReady = await waitForOutput(/removed successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output.toLowerCase()).toMatch(/no active project/);

      // Verify no projects remain and current project is null
      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
      );
      expect(config.projects).toHaveLength(0);
      expect(config.currentProject).toBeNull();
    });

    it('should show error for non-existent project', async () => {
      const { waitForOutput, instance } = await px(
        ['project', 'rm', 'Non Existent'],
        {
          configDir,
        }
      );

      const isReady = await waitForOutput(/failed to remove/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output.toLowerCase()).toMatch(/not found/);
    });
  });

  describe('project command interactions', () => {
    it('should maintain state across commands', async () => {
      // Add multiple projects
      await px(
        ['project', 'add', 'First', '--url', 'https://first.positronic.sh'],
        { configDir }
      );
      await px(
        ['project', 'add', 'Second', '--url', 'https://second.positronic.sh'],
        { configDir }
      );

      let { instance } = await px(['project', 'show'], { configDir });
      let output = instance.lastFrame() || '';
      expect(output).toMatch(/first/i);

      // Switch projects
      await px(['project', 'select', 'Second'], { configDir });

      // Verify switch worked
      ({ instance } = await px(['project', 'show'], { configDir }));
      output = instance.lastFrame() || '';
      expect(output).toMatch(/second/i);

      // List should show second project
      ({ instance } = await px(['project', 'list'], { configDir }));
      output = instance.lastFrame() || '';
      expect(output).toMatch(/second/i);
    });
  });

  describe('CLI Integration: project new', () => {
    let tmpRoot: string;
    let originalLocalPath: string | undefined;

    beforeEach(() => {
      // Set POSITRONIC_LOCAL_PATH to use local template instead of npm
      originalLocalPath = process.env.POSITRONIC_LOCAL_PATH;
      process.env.POSITRONIC_LOCAL_PATH = path.resolve('.');
    });

    afterEach(() => {
      // Restore original environment
      if (originalLocalPath) {
        process.env.POSITRONIC_LOCAL_PATH = originalLocalPath;
      } else {
        delete process.env.POSITRONIC_LOCAL_PATH;
      }

      if (tmpRoot && fs.existsSync(tmpRoot)) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('should create a new project directory and output success message', async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-new-test-'));
      const projectDir = path.join(tmpRoot, 'my-new-project');

      const { waitForOutput, instance } = await px([
        'project',
        'new',
        projectDir,
      ]);

      // Wait for success text from the UI component
      // Note: caz runs `npm install --production` in the template directory when loading it,
      // which can take 5-10+ seconds when tests run concurrently. Using 1500 retries (15s).
      const isReady = await waitForOutput(/project created successfully/i, 1500);
      expect(isReady).toBe(true);

      // Validate CLI output contains the project name
      const output = instance.lastFrame() || '';
      expect(output.toLowerCase()).toContain('my-new-project');

      // Ensure project directory and essential files exist
      expect(fs.existsSync(projectDir)).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, 'positronic.config.json'))
      ).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
    });
  });
});
