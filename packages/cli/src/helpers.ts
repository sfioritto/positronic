#!/usr/bin/env node --no-warnings=DEP0180 --disable-warning=ExperimentalWarning --loader ts-node/esm --experimental-specifier-resolution=node

import path from 'path';
import { access, readdir } from 'fs/promises';
import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { WorkflowRunner, STATUS } from '@positronic/core';
import { AnthropicClient } from '@positronic/client-anthropic';
import { ConsoleAdapter } from './console-adapter.js';
import type { SerializedStep } from '@positronic/core';
import { LocalShell, SSH2Shell } from '@positronic/shell';
import { SQLiteAdapter } from '@positronic/sqlite';
// Import templates for the new command
import {
  developmentTemplate,
  productionTemplate,
  packageJsonTemplate,
  tsConfigTemplate,
  gitignoreTemplate
} from './templates/index.js';


async function getRecentRuns(db: DatabaseType): Promise<Array<{
  id: string;
  workflowName: string;
  status: string;
  createdAt: string;
}>> {
  return db.prepare(`
    SELECT
      id,
      workflow_name as workflowName,
      status,
      created_at as createdAt
    FROM workflow_runs
    ORDER BY created_at DESC
    LIMIT 5
  `).all() as Array<{
    id: string;
    workflowName: string;
    status: string;
    createdAt: string;
  }>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadTypeScriptWorkflow(filePath: string) {
  try {
    // Add .ts extension if not present
    const fullPath = filePath.endsWith('.ts') ? filePath : `${filePath}.ts`;
    const importedModule = await import(path.resolve(fullPath));
    return importedModule.default;

  } catch (error) {
    console.error('Failed to load TypeScript workflow:', error);
    throw error;
  }
}

async function getLastWorkflowRun(db: DatabaseType, runId: string): Promise<{
  runId: string;
  completedSteps: SerializedStep[];
} | null> {
  const run = db.prepare(`
    SELECT * FROM workflow_runs
    WHERE id = ?
  `).get(runId) as any;

  if (!run) {
    return null;
  }

  const completedSteps = db.prepare(`
    SELECT
      id,
      title,
      patch,
      status
    FROM workflow_steps
    WHERE workflow_run_id = ? AND status = 'complete'
    ORDER BY step_order ASC
  `).all(run.id) as any[];

  return {
    runId: run.id,
    completedSteps: completedSteps.map(step => ({
      id: step.id,
      title: step.title,
      status: STATUS.COMPLETE,
      patch: step.patch ? JSON.parse(step.patch) : undefined
    }))
  };
}

async function getMostRecentRunId(db: DatabaseType, workflowName: string): Promise<string | undefined> {
  const run = db.prepare(`
    SELECT id
    FROM workflow_runs
    WHERE workflow_name = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workflowName) as { id: string } | undefined;

  return run?.id;
}

function looksLikePath(input: string): boolean {
  // Check if input contains path separators or starts with ./ or ../
  return input.includes(path.sep) ||
         input.startsWith('./') ||
         input.startsWith('../') ||
         path.isAbsolute(input);
}

async function findFilesRecursively(dir: string, name: string, ignoreDirs: Set<string>): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        results.push(...await findFilesRecursively(fullPath, name, ignoreDirs));
      } else if (entry.isFile() && entry.name === `${name}.ts`) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    // Silently skip directories we can't access
  }

  return results;
}

async function findWorkflowByName(name: string): Promise<string | null> {
  try {
    const ignoreDirs = new Set([
      'node_modules',
      'dist',
      'build',
      'coverage',
      '.git',
      'tmp',
      'temp'
    ]);

    const files = await findFilesRecursively(process.cwd(), name, ignoreDirs);

    if (files.length === 0) {
      return null;
    }

    if (files.length > 1) {
      console.warn('Multiple workflow files found:');
      files.forEach((file: string) => console.warn(`  ${file}`));
      console.warn(`Using first match: ${files[0]}`);
    }

    return files[0];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to search for workflow "${name}": ${message}`);
  }
}

async function resolveWorkflowPath(workflowPath: string): Promise<string> {
  if (looksLikePath(workflowPath)) {
    // If it looks like a path, resolve it normally
    const fullPath = path.resolve(process.cwd(), workflowPath);

    // Add .ts extension if not present
    if (!fullPath.endsWith('.ts')) {
      const withExtension = `${fullPath}.ts`;
      if (await fileExists(withExtension)) {
        return withExtension;
      }
    }

    if (await fileExists(fullPath)) {
      return fullPath;
    }

    throw new Error(`Workflow file not found: ${fullPath}`);
  } else {
    // If it's just a name, search for it
    const foundPath = await findWorkflowByName(workflowPath);
    if (!foundPath) {
      throw new Error(`No workflow file found matching name: ${workflowPath}`);
    }
    return foundPath;
  }
}

// New function to handle the 'new' command
async function createNewProject(projectName: string, verbose: boolean): Promise<void> {
  // Create the project directory
  const targetDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(targetDir)) {
    console.error(`Error: Directory ${projectName} already exists`);
    process.exit(1);
  }

  if (verbose) {
    console.log(`Creating new Positronic project: ${projectName}`);
    console.log(`Target directory: ${targetDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // Generate templates with project name
  const templateProps = { projectName };

  // Write the files
  const filesToGenerate = [
    {
      filename: 'development.ts',
      content: developmentTemplate(templateProps)
    },
    {
      filename: 'production.ts',
      content: productionTemplate(templateProps)
    },
    {
      filename: 'package.json',
      content: packageJsonTemplate(templateProps)
    },
    {
      filename: 'tsconfig.json',
      content: tsConfigTemplate(templateProps)
    },
    {
      filename: '.gitignore',
      content: gitignoreTemplate()
    },
  ];

  for (const file of filesToGenerate) {
    const filePath = path.join(targetDir, file.filename);
    fs.writeFileSync(filePath, file.content);

    if (verbose) {
      console.log(`Created ${file.filename}`);
    }
  }

  console.log(`Project ${projectName} created successfully!`);
  console.log(`To get started:`);
  console.log(`  cd ${projectName}`);
  console.log(`  npm install`);
}