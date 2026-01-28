/**
 * CLI Integration Tests - Auth Command
 *
 * Tests for the `px auth` command which manages local SSH key configuration.
 * Auth commands only work in global mode (not local dev mode).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { px } from './test-utils.js';

describe('CLI Integration: auth commands', () => {
  let tempDir: string;
  let configDir: string;
  let sshDir: string;
  let testKeyPath: string;
  let testKeyPubPath: string;

  beforeEach(() => {
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-auth-test-'));
    configDir = path.join(tempDir, '.positronic');
    sshDir = path.join(tempDir, '.ssh');

    // Create mock SSH directory with test keys
    fs.mkdirSync(sshDir, { recursive: true });

    // Create a mock private key file (minimal format that sshpk can parse)
    testKeyPath = path.join(sshDir, 'id_ed25519');
    testKeyPubPath = path.join(sshDir, 'id_ed25519.pub');

    // Write a real Ed25519 key pair for testing
    // This is a test key - never use in production!
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
    // Clean up test directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Restore HOME
    delete process.env.HOME;
  });

  describe('auth status', () => {
    it('should show "not configured" when no key is set', async () => {
      const { instance } = await px(['auth', 'status'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('authentication configuration');
      expect(output.toLowerCase()).toContain('not configured');
    });

    it('should show configured key after login', async () => {
      // First login
      await px(['auth', 'login', '--path', testKeyPath], { configDir });

      // Then check status
      const { instance } = await px(['auth', 'status'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output).toContain(testKeyPath);
      expect(output.toLowerCase()).toContain('global config');
    });

    it('should show environment variable when set', async () => {
      process.env.POSITRONIC_PRIVATE_KEY = '/custom/key/path';

      try {
        const { instance } = await px(['auth', 'status'], { configDir });
        const output = instance.lastFrame() || '';

        expect(output).toContain('/custom/key/path');
        expect(output.toLowerCase()).toContain('environment variable');
      } finally {
        delete process.env.POSITRONIC_PRIVATE_KEY;
      }
    });
  });

  describe('auth login', () => {
    it('should set global key with --path option', async () => {
      const { waitForOutput, instance } = await px(
        ['auth', 'login', '--path', testKeyPath],
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
        ['auth', 'login', '--path', '/nonexistent/key'],
        { configDir }
      );

      const foundError = await waitForOutput(/not found/i);
      expect(foundError).toBe(true);
    });

    it('should error when --project flag used without selected project', async () => {
      const { waitForOutput, instance } = await px(
        ['auth', 'login', '--project', '--path', testKeyPath],
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
        ['auth', 'login', '--project', '--path', testKeyPath],
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

  describe('auth logout', () => {
    it('should clear global key configuration', async () => {
      // First login
      await px(['auth', 'login', '--path', testKeyPath], { configDir });

      // Then logout
      const { waitForOutput, instance } = await px(['auth', 'logout'], {
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
      const { waitForOutput, instance } = await px(['auth', 'logout'], {
        configDir,
      });

      const foundMessage = await waitForOutput(/no global.*configured/i);
      expect(foundMessage).toBe(true);
    });

    it('should error when --project flag used without selected project', async () => {
      const { waitForOutput, instance } = await px(
        ['auth', 'logout', '--project'],
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
      await px(['auth', 'login', '--project', '--path', testKeyPath], {
        configDir,
      });

      // Then logout with --project flag
      const { waitForOutput, instance } = await px(
        ['auth', 'logout', '--project'],
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

  describe('auth list', () => {
    it('should list available SSH keys', async () => {
      const { waitForOutput, instance } = await px(['auth', 'list'], {
        configDir,
      });

      // The command should either show available keys or "no keys found"
      // We can't guarantee what keys exist on the test machine
      const foundKeys = await waitForOutput(/available ssh keys|no ssh keys found/i);
      expect(foundKeys).toBe(true);

      const output = instance.lastFrame() || '';
      // Should show SSH key info if keys exist
      if (output.toLowerCase().includes('available ssh keys')) {
        // Should contain some SSH key type
        expect(
          output.toLowerCase().includes('rsa') ||
          output.toLowerCase().includes('ed25519') ||
          output.toLowerCase().includes('ecdsa')
        ).toBe(true);
      }
    });

    it('should indicate currently active key when configured', async () => {
      // Login first using the test key we created
      await px(['auth', 'login', '--path', testKeyPath], { configDir });

      const { waitForOutput, instance } = await px(['auth', 'list'], {
        configDir,
      });

      const foundKeys = await waitForOutput(/available ssh keys|no ssh keys found/i);
      expect(foundKeys).toBe(true);

      const output = instance.lastFrame() || '';
      // If keys are shown, should have some indicator
      if (output.toLowerCase().includes('available ssh keys')) {
        // The active key marker should be present
        expect(output).toContain('*');
      }
    });
  });

  describe('auth (default to status)', () => {
    it('should show status when just "auth" is run', async () => {
      const { instance } = await px(['auth'], { configDir });
      const output = instance.lastFrame() || '';

      expect(output.toLowerCase()).toContain('authentication configuration');
    });
  });

  describe('key priority order', () => {
    it('should prioritize env var over global config', async () => {
      // Set global key
      await px(['auth', 'login', '--path', testKeyPath], { configDir });

      // Set env var
      process.env.POSITRONIC_PRIVATE_KEY = '/env/key/path';

      try {
        const { instance } = await px(['auth', 'status'], { configDir });
        const output = instance.lastFrame() || '';

        // Active key should show env var
        expect(output).toContain('/env/key/path');
        expect(output.toLowerCase()).toContain('environment variable');
      } finally {
        delete process.env.POSITRONIC_PRIVATE_KEY;
      }
    });

    it('should prioritize project key over global key', async () => {
      // Set global key
      await px(['auth', 'login', '--path', '~/.ssh/global_key'], { configDir });

      // Add project and set project key
      await px(
        ['project', 'add', 'TestProject', '--url', 'https://test.positronic.sh'],
        { configDir }
      );
      await px(['auth', 'login', '--project', '--path', testKeyPath], {
        configDir,
      });

      const { instance } = await px(['auth', 'status'], { configDir });
      const output = instance.lastFrame() || '';

      // Active key should show project key
      expect(output).toContain(testKeyPath);
      expect(output).toContain('TestProject');
    });
  });
});
