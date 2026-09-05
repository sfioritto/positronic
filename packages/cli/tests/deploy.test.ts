import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestEnv, px, type TestEnv } from './test-utils.js';
import type { TestDevServer } from './test-dev-server.js';

async function waitForDeployCall(server: TestDevServer, maxTries = 100) {
  for (let tries = 0; tries < maxTries; tries++) {
    if (server.getLogs().some((call) => call.method === 'deploy')) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe('CLI Integration: px deploy', () => {
  let env: TestEnv;
  let exitSpy: any;
  let savedRootPublicKey: string | undefined;

  beforeEach(async () => {
    env = await createTestEnv();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    savedRootPublicKey = process.env.ROOT_PUBLIC_KEY;
    delete process.env.ROOT_PUBLIC_KEY;
  });

  afterEach(() => {
    if (savedRootPublicKey !== undefined) {
      process.env.ROOT_PUBLIC_KEY = savedRootPublicKey;
    }
    env.cleanup();
    exitSpy.mockRestore();
  });

  it('deploys immediately when ROOT_PUBLIC_KEY is in the project .env', async () => {
    const { server } = env;
    fs.writeFileSync(
      path.join(env.projectRootDir, '.env'),
      `ROOT_PUBLIC_KEY='{"kty":"OKP","crv":"Ed25519","x":"test"}'\n`
    );

    await px(['deploy'], {
      server,
      projectRootDir: env.projectRootDir,
      configDir: env.projectRootDir,
    });

    expect(await waitForDeployCall(server)).toBe(true);
  });

  it('runs auth setup to create a root key, then deploys', async () => {
    const { server } = env;
    const envPath = path.join(env.projectRootDir, '.env');
    fs.rmSync(envPath, { force: true });

    // Point key discovery at a temp dir holding a single SSH key so auth
    // setup auto-selects it without user interaction
    const sshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-ssh-'));
    execSync(
      `ssh-keygen -t ed25519 -N "" -q -f ${path.join(sshDir, 'id_ed25519')}`
    );
    process.env.POSITRONIC_SSH_DIR = sshDir;

    try {
      const { waitForOutput } = await px(['deploy'], {
        server,
        projectRootDir: env.projectRootDir,
        configDir: env.projectRootDir,
      });

      expect(await waitForOutput(/Authentication configured/i, 100)).toBe(true);
      expect(await waitForDeployCall(server)).toBe(true);

      // Auth setup wrote the root key to the project .env
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).toContain('ROOT_PUBLIC_KEY=');
    } finally {
      delete process.env.POSITRONIC_SSH_DIR;
      fs.rmSync(sshDir, { recursive: true, force: true });
    }
  });
});
