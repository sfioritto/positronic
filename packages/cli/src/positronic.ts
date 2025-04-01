#!/usr/bin/env node --no-warnings=DEP0180 --disable-warning=ExperimentalWarning --loader ts-node/esm --experimental-specifier-resolution=node

import path from 'path';
import { access, readdir } from 'fs/promises';
import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { WorkflowRunner, STATUS } from '@positronic/core';
import { AnthropicClient } from '@positronic/client-anthropic';
import { ConsoleAdapter } from './console-adapter';
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
} from './templates/project';

interface CliOptions {
  verbose?: boolean;
  restartFrom?: number;
  endAfter?: number;
  runId?: string;
  listRuns?: boolean;
  listSteps?: boolean;
  new?: boolean;
}

function parseArgs(): CliOptions & { workflowPath?: string; projectName?: string } {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  const nonOptionArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key] = arg.slice(2).split('=');
      switch (key) {
        case 'help':
          printHelp();
          process.exit(0);
        case 'verbose':
          options.verbose = true;
          break;
        case 'restart-from':
          options.restartFrom = parseInt(arg.split('=')[1], 10);
          break;
        case 'end-after':
          options.endAfter = parseInt(arg.split('=')[1], 10);
          break;
        case 'run-id':
          options.runId = arg.split('=')[1];
          break;
        case 'list-runs':
          options.listRuns = true;
          break;
        case 'list-steps':
          options.listSteps = true;
          break;
      }
    } else if (arg.startsWith('-')) {
      const flag = arg.slice(1);
      switch (flag) {
        case 'h':
          printHelp();
          process.exit(0);
        case 'v':
          options.verbose = true;
          break;
        case 'r':
          // For short options, the value is the next argument
          if (i + 1 <= args.length) {
            options.restartFrom = parseInt(args[++i], 10);
          }
          break;
        case 'e':
          if (i + 1 <= args.length) {
            options.endAfter = parseInt(args[++i], 10);
          }
          break;
      }
    } else {
      // Handle subcommands
      if (arg === 'new' && nonOptionArgs.length === 0) {
        options.new = true;
      } else {
        nonOptionArgs.push(arg);
      }
    }
  }

  // Extract projectName only for 'new' command
  let projectName: string | undefined;
  if (options.new && nonOptionArgs.length > 0) {
    projectName = nonOptionArgs[0];
    nonOptionArgs.shift(); // Remove the project name
  }

  return {
    ...options,
    workflowPath: options.new ? undefined : nonOptionArgs[0],
    projectName
  };
}

function printHelp() {
  console.log(`
Usage: positronic [command] [options] [args]

Commands:
  positronic <workflow>       Run a workflow
  positronic new <name>       Create a new Positronic project

The <workflow> argument can be either:
  - A path to a workflow file (e.g. ./workflows/my-workflow.ts)
  - A workflow name (e.g. test-coverage) which will be searched for recursively

Options:
  --help, -h           Show this help message
  --verbose, -v        Enable verbose logging
  --restart-from=<n>   Restart workflow from step n
  -r <n>               Shorthand for --restart-from
  --end-after=<n>      Stop workflow after completing step n
  -e <n>               Shorthand for --end-after
  --run-id=<id>        Specify workflow run ID (optional with --restart-from)
  --list-runs          List recent workflow runs
  --list-steps         List all steps in the workflow

Examples:
  # Create a new Positronic project
  positronic new my-workflows

  # Run a workflow by path
  positronic ./workflows/my-workflow.ts

  # Run a workflow by name (searches recursively)
  positronic test-coverage

  # List recent workflow runs
  positronic --list-runs

  # Restart a workflow from step 3 (uses most recent run)
  positronic --restart-from=3 test-coverage
  # Or using shorthand:
  positronic -r 3 test-coverage

  # Run workflow and stop after step 5
  positronic --end-after=5 test-coverage
  # Or using shorthand:
  positronic -e 5 test-coverage

  # Restart from step 3 and run through step 5
  positronic --restart-from=3 --end-after=5 test-coverage
  # Or using shorthand:
  positronic -r 3 -e 5 test-coverage

  # Run workflow with verbose output
  positronic -v test-coverage

  # Restart a specific run from step 3
  positronic --run-id=abc123 --restart-from=3 test-coverage
`);
}

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

async function main() {
  try {
    const { workflowPath, projectName, verbose, restartFrom, endAfter, runId, listRuns, listSteps, new: isNew } = parseArgs();

    // Handle new command
    if (isNew) {
      if (!projectName) {
        console.error('Error: Project name is required for the "new" command');
        console.log('Usage: positronic new <project-name>');
        process.exit(1);
      }

      await createNewProject(projectName, !!verbose);
      process.exit(0);
    }

    const db = new Database('workflows.db');

    // Handle list-runs command
    if (listRuns) {
      const recentRuns = await getRecentRuns(db);
      console.log('-------------------');
      recentRuns.forEach(run => {
        console.log(`ID: ${run.id}`);
        console.log(`Workflow: ${run.workflowName}`);
        console.log(`Status: ${run.status}`);
        console.log(`Created: ${run.createdAt}`);
        console.log('-------------------');
      });
      process.exit(0);
    }

    // Require workflow path for other operations
    if (!workflowPath) {
      throw new Error('Workflow path is required unless using --list-runs or the "new" command');
    }

    const resolvedPath = await resolveWorkflowPath(workflowPath);
    const workflow = await loadTypeScriptWorkflow(resolvedPath);
    if (!workflow || workflow.type !== 'workflow') {
      throw new Error(`File ${resolvedPath} does not export a workflow as default export\n\n`);
    }

    // Handle list-steps command
    if (listSteps) {
      console.log('Steps in workflow:', workflow.title);
      console.log('-------------------');
      if (!workflow.blocks || !Array.isArray(workflow.blocks)) {
        console.log('No steps found in workflow');
        process.exit(1);
      }
      workflow.blocks.forEach((step: { title: string }, index: number) => {
        console.log(`${index + 1}. ${step.title}`);
      });
      process.exit(0);
    }

    let completedSteps: SerializedStep[] = [];
    let workflowRunId: string | undefined;

    if (restartFrom !== undefined) {
      let targetRunId = runId;

      // If no run ID provided, get the most recent run for this workflow
      if (!targetRunId) {
        targetRunId = await getMostRecentRunId(db, workflow.title);
        if (!targetRunId) {
          throw new Error(`No previous runs found for workflow: ${workflow.title}`);
        }
      }

      const lastRun = await getLastWorkflowRun(db, targetRunId);
      if (!lastRun) {
        throw new Error(`No run found with ID: ${targetRunId}`);
      }

      const stepsToKeep = restartFrom - 1;
      completedSteps = lastRun.completedSteps.slice(0, stepsToKeep);
      workflowRunId = lastRun.runId;

      if (completedSteps.length < stepsToKeep) {
        throw new Error(`Workflow only has ${completedSteps.length} steps, cannot restart from step ${restartFrom}`);
      }
    }

    const currentWorkflowDir = path.dirname(resolvedPath);

    // Set up environment variables for the workflow
    const env: Record<string, string> = {};
    if (process.env.GITHUB_TOKEN) {
      env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    }

    let shell;
    if (process.env.NODE_ENV === 'production') {
      shell = new SSH2Shell({
        host: '37.16.27.38',
        username: 'root',
        port: 2222,
        agent: process.env.SSH_AUTH_SOCK,
        env,
        cwd: process.env.POSITRONIC_CWD
      });

      // Connect to SSH shell before running workflow
      await shell.connect();
    } else {
      shell = new LocalShell({
        cwd: process.env.POSITRONIC_CWD
      });
    }

    const runner = new WorkflowRunner({
      adapters: [
        new SQLiteAdapter(db),
        new ConsoleAdapter(restartFrom || 1)
      ],
      logger: console,
      verbose: !!verbose,
      client: new AnthropicClient(),
    });

    try {
      await runner.run(workflow, {
        initialState: {},
        initialCompletedSteps: completedSteps,
        workflowRunId,
        endAfter
      });
    } finally {
      if (shell instanceof SSH2Shell) {
        await shell.disconnect();
      }
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error('Failed to run workflow:', error.message);
      if (error.stack) console.error(error.stack);
    }
    process.exit(1);
  }
}

main();