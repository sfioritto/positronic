import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { renderTemplate } from '@positronic/core';
import { scaffoldProject } from '../src/index.js';

// The scaffold lands inside this package so the compiled brains resolve
// oxc-parser, oxc-transform and @positronic/core from the monorepo root.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('build-brains.mjs', () => {
  let dest: string;

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(packageDir, '.build-brains-'));
    scaffoldProject({ name: 'demo', dest });
  });

  afterEach(() => {
    fs.rmSync(dest, { recursive: true, force: true });
  });

  const writeBrain = (file: string, source: string) => {
    const target = path.join(dest, 'src', 'brains', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };

  const build = () =>
    execFileSync(process.execPath, ['build-brains.mjs'], {
      cwd: path.join(dest, '.positronic'),
      stdio: 'pipe',
    });

  it('preserves newlines in JSX text', async () => {
    writeBrain(
      'whitespace.tsx',
      `export const template = (name: string) => (
  <>
    Hello {name}
    Second line with \`backticks\` and a $ sign {name}
  </>
);
`
    );

    build();

    const compiled = await import(
      path.join(dest, '.positronic', 'brains', 'whitespace.js')
    );
    const rendered = await renderTemplate(compiled.template('Ada'), {});

    // renderTemplate dedents, so the indentation goes but the line break stays.
    expect(rendered).toBe(
      'Hello Ada\nSecond line with `backticks` and a $ sign Ada'
    );
  });

  it('mirrors the src/brains layout and skips underscore-prefixed files', () => {
    writeBrain('top.ts', `export default { name: 'top' };\n`);
    writeBrain('nested/inner.ts', `export default { name: 'inner' };\n`);
    writeBrain('_shared.ts', `export const shared = 1;\n`);

    build();

    const brainsDir = path.join(dest, '.positronic', 'brains');
    expect(fs.existsSync(path.join(brainsDir, 'top.js'))).toBe(true);
    expect(fs.existsSync(path.join(brainsDir, 'nested', 'inner.js'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(brainsDir, '_shared.js'))).toBe(false);
  });

  it('reports the file name when a brain fails to parse', () => {
    writeBrain('broken.tsx', `export const t = (<>unclosed\n`);

    expect(build).toThrow(/broken\.tsx/);
  });
});
