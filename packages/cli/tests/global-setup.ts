/**
 * Scaffolds the project template once per test run and hands the path to
 * every worker via provide/inject. Running caz per test file (it spawns npm
 * and git) was enough contention to push the first test in each file past
 * the timeout when all files start together.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { TestProject } from 'vitest/node';

// Global setup runs in Vitest's module runner, not a test worker, so the
// deps.interopDefault setting does not apply here. Load caz through Node's
// own require to get the plain CommonJS shape the CLI itself relies on.
const require = createRequire(import.meta.url);
const caz = require('caz');

declare module 'vitest' {
  export interface ProvidedContext {
    templatePath: string;
  }
}

export default async function setup({ provide }: TestProject) {
  const devPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../'
  );
  const originalTemplate = path.resolve(
    devPath,
    'packages/template-new-project'
  );

  // Copy the template to a temp location so caz can mess with that copy.
  const tempCopyDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-template-copy-')
  );
  fs.cpSync(originalTemplate, tempCopyDir, { recursive: true });

  const templatePath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-cached-template-')
  );

  // caz writes progress to stdout and stderr; keep it out of the test output.
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    await caz.default(tempCopyDir, templatePath, {
      name: 'test-project',
      backend: 'none',
      install: false,
      claudemd: false,
      force: true,
    });
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  fs.rmSync(tempCopyDir, { recursive: true, force: true });

  provide('templatePath', templatePath);

  return () => {
    fs.rmSync(templatePath, { recursive: true, force: true });
  };
}
