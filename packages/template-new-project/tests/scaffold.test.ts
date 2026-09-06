import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scaffoldProject } from '../src/index.js';

describe('scaffoldProject', () => {
  let dest: string;

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-scaffold-'));
  });

  afterEach(() => {
    fs.rmSync(dest, { recursive: true, force: true });
  });

  const read = (file: string) => fs.readFileSync(path.join(dest, file), 'utf8');

  it('renders valid JSON with the cloudflare dependency for the cloudflare backend', () => {
    // Running from the monorepo would auto-detect it; point at a plain dir
    // so the npm ranges are exercised.
    scaffoldProject({ name: 'demo', dest, devRootPath: os.tmpdir() });

    const pkg = JSON.parse(read('package.json'));
    const serverPkg = JSON.parse(read('.positronic/package.json'));
    const config = JSON.parse(read('positronic.config.json'));

    expect(pkg.name).toBe('demo');
    expect(pkg.dependencies['@positronic/cloudflare']).toMatch(/^\^\d/);
    expect(serverPkg.dependencies['@positronic/cloudflare']).toMatch(/^\^\d/);
    expect(config.backend).toEqual({
      type: 'cloudflare',
      package: '@positronic/cloudflare',
    });
  });

  it('renders valid JSON without the cloudflare dependency for the none backend', () => {
    scaffoldProject({ name: 'demo', dest, backend: 'none', claudeMd: false });

    const pkg = JSON.parse(read('package.json'));
    const config = JSON.parse(read('positronic.config.json'));

    expect(pkg.dependencies['@positronic/cloudflare']).toBeUndefined();
    expect(config.backend).toEqual({ type: 'none', package: '' });
    expect(fs.existsSync(path.join(dest, 'CLAUDE.md'))).toBe(false);
  });

  it('renames _gitignore and _env and leaves template literals untouched', () => {
    scaffoldProject({ name: 'demo', dest });

    expect(fs.existsSync(path.join(dest, '.gitignore'))).toBe(true);
    expect(read('.env')).toContain('R2_BUCKET_NAME=demo');
    expect(read('src/brain.ts')).toContain('${state.task}');
    expect(read('.positronic/build-brains.mjs')).toContain('${escaped}');
  });

  it('writes file: references when devRootPath points at a monorepo', () => {
    const monorepo = path.resolve(import.meta.dirname, '../../..');
    scaffoldProject({ name: 'demo', dest, devRootPath: monorepo });

    const pkg = JSON.parse(read('package.json'));
    const config = JSON.parse(read('positronic.config.json'));

    expect(pkg.dependencies['@positronic/core']).toBe(
      `file:${path.join(monorepo, 'packages', 'core')}`
    );
    expect(config.backend.package).toBe(
      `file:${path.join(monorepo, 'packages', 'cloudflare')}`
    );
  });

  it('renders only a subdirectory into dest when subdir is set', () => {
    scaffoldProject({ name: 'demo', dest, subdir: '.positronic' });

    expect(fs.readdirSync(dest).sort()).toEqual([
      'build-brains.mjs',
      'bundle.ts',
      'package.json',
      'src',
      'styles.css',
      'tsconfig.json',
      'vite.config.mjs',
      'wrangler.jsonc',
    ]);
    expect(read('wrangler.jsonc')).toContain('"name": "demo"');
  });

  it('refuses a non-empty destination', () => {
    fs.writeFileSync(path.join(dest, 'existing.txt'), 'x');

    expect(() => scaffoldProject({ name: 'demo', dest })).toThrow(
      /already exists and is not empty/
    );
  });
});
