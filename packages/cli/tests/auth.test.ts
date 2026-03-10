/**
 * CLI Integration Tests - Auth Commands
 *
 * Tests for `px login`, `px logout`, and `px whoami` commands.
 * These are top-level commands that manage local SSH key configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';

describe('CLI Integration: auth commands', () => {
  let tempDir: string;
  let configDir: string;
  let sshDir: string;
  let testKeyPath: string;
  let testKeyPubPath: string;

  beforeEach(() => {
    // Clear any POSITRONIC_PRIVATE_KEY that may have been set by other tests
    delete process.env.POSITRONIC_PRIVATE_KEY;

    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-auth-test-'));
    configDir = path.join(tempDir, '.positronic');
    sshDir = path.join(tempDir, '.ssh');

    // Create mock SSH directory with test keys
    fs.mkdirSync(sshDir, { recursive: true });

    // Create a mock private key file
    testKeyPath = path.join(sshDir, 'id_ed25519');
    testKeyPubPath = path.join(sshDir, 'id_ed25519.pub');

    // Write a real Ed25519 key pair for testing
    const testPrivateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBHK9totwRFqGY0xAKJUT+WV7c03PPGfJGxXQAAAAjJcHwzyXB8MwAAAAtz
c2gtZWQyNTUxOQAAACBHK9totwRFqGY0xAKJUT+WV7c03PPGfJGxXQAAAAjHkgRoFCFo7H
kr22i3BEWoZjTEAolRP5ZXtzTc88Z8kbFdAAAAANIQAAABF0ZXN0QGV4YW1wbGUuY29t
-----END OPENSSH PRIVATE KEY-----`;

    const testPublicKey =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEcr22i3BEWoZjTEAolRP5ZXtzTc88Z8kbFdCMlwfDPJ test@example.com';

    fs.writeFileSync(testKeyPath, testPrivateKey);
    fs.writeFileSync(testKeyPubPath, testPublicKey);

    // Set HOME to temp dir so discoverSSHKeys finds our test keys
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.HOME;
  });

  describe('login', () => {
    it('should set global key with --path option', async () => {
      const { waitForOutput, instance } = await px(
        ['login', '--path', testKeyPath],
        { configDir }
      );

      const isReady = await waitForOutput(/configured successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output).toContain(testKeyPath);
      expect(output.toLowerCase()).toContain('global');

      // Verify config file was updated
      const configPath = path.join(configDir, 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.defaultPrivateKeyPath).toBe(testKeyPath);
    });

    it('should error when key file not found', async () => {
      const { waitForOutput, instance } = await px(
        ['login', '--path', '/nonexistent/key'],
        { configDir }
      );

      const foundError = await waitForOutput(/not found/i);
      expect(foundError).toBe(true);
    });

    it('should error when --project flag used without selected project', async () => {
      const { waitForOutput, instance } = await px(
        ['login', '--project', '--path', testKeyPath],
        { configDir }
      );

      const foundError = await waitForOutput(/no project selected/i);
      expect(foundError).toBe(true);
    });

    it('should set per-project key when project is selected', async () => {
      // First add and select a project
      await px(
        ['project', 'add', 'TestProject', '--url', 'https://test.positronic.sh'],
        { configDir }
      );

      // Then login with --project flag
      const { waitForOutput, instance } = await px(
        ['login', '--project', '--path', testKeyPath],
        { configDir }
      );

      const isReady = await waitForOutput(/configured successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output).toContain('TestProject');

      // Verify config file was updated
      const configPath = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.projects[0].privateKeyPath).toBe(testKeyPath);
    });
  });

  describe('logout', () => {
    it('should clear global key configuration', async () => {
      // First login
      await px(['login', '--path', testKeyPath], { configDir });

      // Then logout
      const { waitForOutput, instance } = await px(['logout'], {
        configDir,
      });

      const isReady = await waitForOutput(/cleared/i);
      expect(isReady).toBe(true);

      // Verify config was updated
      const configPath = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.defaultPrivateKeyPath).toBeUndefined();
    });

    it('should show message when no key is configured', async () => {
      const { waitForOutput, instance } = await px(['logout'], {
        configDir,
      });

      const foundMessage = await waitForOutput(/no global.*configured/i);
      expect(foundMessage).toBe(true);
    });

    it('should error when --project flag used without selected project', async () => {
      const { waitForOutput, instance } = await px(
        ['logout', '--project'],
        { configDir }
      );

      const foundError = await waitForOutput(/no project selected/i);
      expect(foundError).toBe(true);
    });

    it('should clear per-project key when project is selected', async () => {
      // First add and select a project
      await px(
        ['project', 'add', 'TestProject', '--url', 'https://test.positronic.sh'],
        { configDir }
      );

      // Login with --project flag
      await px(['login', '--project', '--path', testKeyPath], {
        configDir,
      });

      // Then logout with --project flag
      const { waitForOutput, instance } = await px(
        ['logout', '--project'],
        { configDir }
      );

      const isReady = await waitForOutput(/cleared.*TestProject/i);
      expect(isReady).toBe(true);

      // Verify config was updated
      const configPath = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.projects[0].privateKeyPath).toBeUndefined();
    });
  });

  describe('whoami', () => {
    it('should show identity when authenticated', async () => {
      const env = await createTestEnv();
      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn(['whoami']);

        const found = await waitForOutput(/logged in as/i, 30);
        expect(found).toBe(true);

        const output = instance.lastFrame() || '';
        expect(output).toContain('root');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors gracefully', async () => {
      const env = await createTestEnv();

      try {
        const { waitForOutput } = await px(['whoami'], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting to the local development server/i
        );
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });
  });

  describe('dev mode auth (local project key)', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = path.join(tempDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });
    });

    it('should write .positronic-auth.json on login in dev mode', async () => {
      const { waitForOutput, instance } = await px(
        ['login', '--path', testKeyPath],
        { configDir, projectRootDir: projectDir, skipAuthSetup: true }
      );

      const isReady = await waitForOutput(/configured successfully/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output).toContain(testKeyPath);
      expect(output.toLowerCase()).toContain('local project');

      // Verify .positronic-auth.json was created
      const authFilePath = path.join(projectDir, '.positronic-auth.json');
      expect(fs.existsSync(authFilePath)).toBe(true);

      const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf-8'));
      expect(authData.privateKeyPath).toBe(testKeyPath);

      // Verify global config was NOT modified with a defaultPrivateKeyPath
      const configPath = path.join(configDir, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(config.defaultPrivateKeyPath).toBeUndefined();
      }
    });

    it('should clear .positronic-auth.json on logout in dev mode', async () => {
      // First login in dev mode
      await px(
        ['login', '--path', testKeyPath],
        { configDir, projectRootDir: projectDir, skipAuthSetup: true }
      );

      // Then logout in dev mode
      const { waitForOutput, instance } = await px(
        ['logout'],
        { configDir, projectRootDir: projectDir, skipAuthSetup: true }
      );

      const isReady = await waitForOutput(/cleared/i);
      expect(isReady).toBe(true);

      const output = instance.lastFrame() || '';
      expect(output.toLowerCase()).toContain('local project');

      // Verify .positronic-auth.json was removed
      const authFilePath = path.join(projectDir, '.positronic-auth.json');
      expect(fs.existsSync(authFilePath)).toBe(false);
    });

    it('should show no local key message on logout when none configured', async () => {
      const { waitForOutput } = await px(
        ['logout'],
        { configDir, projectRootDir: projectDir, skipAuthSetup: true }
      );

      const foundMessage = await waitForOutput(/no local project.*configured/i);
      expect(foundMessage).toBe(true);
    });
  });
});
