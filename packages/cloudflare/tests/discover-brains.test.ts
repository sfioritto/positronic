import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { discoverBrains } from '../src/dev-server.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('discoverBrains', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brains-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('discovers brains from direct .ts files', async () => {
    await fs.promises.writeFile(
      path.join(tempDir, 'simple-brain.ts'),
      'export default {}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([
      { name: 'simple-brain', relativePath: 'simple-brain.ts' },
    ]);
  });

  it('discovers brains from subdirectories with index.ts', async () => {
    const subdir = path.join(tempDir, 'complex-brain');
    await fs.promises.mkdir(subdir);
    await fs.promises.writeFile(
      path.join(subdir, 'index.ts'),
      'export default {}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([
      { name: 'complex-brain', relativePath: 'complex-brain/index.ts' },
    ]);
  });

  it('discovers brains from both patterns', async () => {
    // Direct file
    await fs.promises.writeFile(
      path.join(tempDir, 'simple-brain.ts'),
      'export default {}'
    );

    // Subdirectory with index.ts
    const subdir = path.join(tempDir, 'complex-brain');
    await fs.promises.mkdir(subdir);
    await fs.promises.writeFile(
      path.join(subdir, 'index.ts'),
      'export default {}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toHaveLength(2);
    expect(brains).toContainEqual({
      name: 'simple-brain',
      relativePath: 'simple-brain.ts',
    });
    expect(brains).toContainEqual({
      name: 'complex-brain',
      relativePath: 'complex-brain/index.ts',
    });
  });

  it('ignores files and directories starting with underscore', async () => {
    await fs.promises.writeFile(
      path.join(tempDir, '_helper.ts'),
      'export const helper = {}'
    );

    const subdir = path.join(tempDir, '_internal');
    await fs.promises.mkdir(subdir);
    await fs.promises.writeFile(
      path.join(subdir, 'index.ts'),
      'export default {}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([]);
  });

  it('ignores subdirectories without index.ts', async () => {
    const subdir = path.join(tempDir, 'no-index');
    await fs.promises.mkdir(subdir);
    await fs.promises.writeFile(
      path.join(subdir, 'helper.ts'),
      'export const helper = {}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([]);
  });

  it('ignores non-.ts files', async () => {
    await fs.promises.writeFile(
      path.join(tempDir, 'readme.md'),
      '# Readme'
    );
    await fs.promises.writeFile(
      path.join(tempDir, 'config.json'),
      '{}'
    );

    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([]);
  });

  it('returns empty array for non-existent directory', async () => {
    const brains = await discoverBrains('/non/existent/path');

    expect(brains).toEqual([]);
  });

  it('returns empty array for empty directory', async () => {
    const brains = await discoverBrains(tempDir);

    expect(brains).toEqual([]);
  });
});
