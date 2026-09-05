import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDevServer } from '../src/commands/backend.js';

// The loader imports the backend's built Node entry point directly, so it
// has to agree with where the backend package puts it. A fake backend with
// the same layout pins that contract down without building anything.
function writeFakeBackend(packageRoot: string, tag: string) {
  const dist = path.join(packageRoot, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(
    path.join(dist, 'node-index.js'),
    `export class DevServer { constructor(root) { this.root = root; this.tag = '${tag}'; } }`
  );
}

function writeProject(projectRoot: string, backendPackage: string) {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'positronic.config.json'),
    JSON.stringify({ backend: { type: 'fake', package: backendPackage } })
  );
}

describe('createDevServer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-backend-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads a file: backend from its dist entry point', async () => {
    const backendRoot = path.join(tempDir, 'local-backend');
    const projectRoot = path.join(tempDir, 'project');
    writeFakeBackend(backendRoot, 'local');
    writeProject(projectRoot, `file:${backendRoot}`);

    const server = await createDevServer(projectRoot);

    expect(server).toMatchObject({ root: projectRoot, tag: 'local' });
  });

  it('loads an installed backend from the project node_modules', async () => {
    const projectRoot = path.join(tempDir, 'project');
    writeProject(projectRoot, '@positronic/fake-backend');
    writeFakeBackend(
      path.join(projectRoot, 'node_modules', '@positronic', 'fake-backend'),
      'installed'
    );

    const server = await createDevServer(projectRoot);

    expect(server).toMatchObject({ root: projectRoot, tag: 'installed' });
  });
});
