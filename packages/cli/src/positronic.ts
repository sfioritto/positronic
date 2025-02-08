#!/usr/bin/env NODE_NO_WARNINGS=1 node --loader ts-node/esm --experimental-specifier-resolution=node

import path from 'path';
import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteAdapter } from '../../adapter-sqlite/src';
import { WorkflowRunner } from '../../positronic/src/dsl/workflow-runner';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { STATUS } from '../../positronic/src/dsl/constants';
import type { SerializedStep } from '../../positronic/src/dsl/workflow';

interface CliOptions {
  workflowDir?: string;
  stateFile?: string;
  verbose?: boolean;
  restartFrom?: number;
}

function parseArgs(): CliOptions & { workflowPath: string } {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  const nonOptionArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key] = arg.slice(2).split('=');
      switch (key) {
        case 'workflow-dir':
          options.workflowDir = arg.split('=')[1];
          break;
        case 'state':
          options.stateFile = arg.split('=')[1];
          break;
        case 'verbose':
          options.verbose = true;
          break;
        case 'restartFrom':
          options.restartFrom = parseInt(arg.split('=')[1], 10);
          break;
      }
    } else {
      nonOptionArgs.push(arg);
    }
  }

  return { ...options, workflowPath: nonOptionArgs[0] };
}

async function loadState(stateFile?: string) {
  if (!stateFile) return {};

  const fullPath = path.resolve(process.cwd(), stateFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`State file not found: ${stateFile}`);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

async function loadTypeScriptWorkflow(filePath: string) {
  try {
    const importedModule = await import(path.resolve(filePath));
    return importedModule.default;
  } catch (error) {
    console.error('Failed to load TypeScript workflow:', error);
    throw error;
  }
}

async function initializeDatabase(dbPath: string) {
  const db = new Database(dbPath);

  // Check if tables exist
  const tableExists = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table' AND name='workflow_runs'
  `).get();

  if (!tableExists) {
    // Get the current file's path and construct the path to init.sql
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);
    const initSql = fs.readFileSync(path.join(currentDir, '../init.sql'), 'utf8');
    db.exec(initSql);
  }

  return db;
}

async function getLastWorkflowRun(db: DatabaseType, workflowName: string) {
  const lastRun = db.prepare(`
    SELECT * FROM workflow_runs
    WHERE workflow_name = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workflowName) as any;

  if (!lastRun) {
    return null;
  }

  const completedSteps = db.prepare(`
    SELECT * FROM workflow_steps
    WHERE workflow_run_id = ?
    ORDER BY id ASC
  `).all(lastRun.id) as any[];

  return {
    runId: lastRun.id,
    completedSteps: completedSteps.map(step => ({
      title: step.title,
      state: JSON.parse(step.new_state),
      status: STATUS.COMPLETE
    }))
  };
}

async function main() {
  try {
    const { workflowPath, workflowDir, stateFile, verbose, restartFrom } = parseArgs();

    const fullPath = workflowDir
      ? path.resolve(process.cwd(), workflowDir, workflowPath)
      : path.resolve(process.cwd(), workflowPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Workflow file not found: ${fullPath}. CWD: ${process.cwd()}`);
    }

    const workflow = await loadTypeScriptWorkflow(fullPath);

    if (!workflow || workflow.type !== 'workflow') {
      throw new Error(`File ${workflowPath} does not export a workflow as default export`);
    }

    // Configure workflow in development mode
    if (process.env.NODE_ENV === 'development') {
      const workflowDirectory = path.dirname(fullPath);
      workflow.configure({ workflowDir: workflowDirectory });
    }

    const initialState = await loadState(stateFile);
    const db = await initializeDatabase('workflows.db');

    let completedSteps: SerializedStep[] = [];
    let workflowRunId: number | undefined;

    if (restartFrom !== undefined) {
      const lastRun = await getLastWorkflowRun(db, workflow.name);
      if (!lastRun) {
        throw new Error(`No previous runs found for workflow: ${workflow.name}`);
      }

      const stepsToKeep = restartFrom - 1;
      completedSteps = lastRun.completedSteps.slice(0, stepsToKeep);
      workflowRunId = lastRun.runId;

      if (completedSteps.length < stepsToKeep) {
        throw new Error(`Workflow only has ${completedSteps.length} steps, cannot restart from step ${restartFrom}`);
      }
    }

    const runner = new WorkflowRunner(
      {
        adapters: [new SQLiteAdapter(db, workflowRunId)],
        logger: console,
        verbose: !!verbose,
      }
    );

    await runner.run(workflow, initialState, completedSteps, { workflowRunId });

  } catch (error) {
    if (error instanceof Error) {
      console.error('Failed to run workflow:', error.message);
      if (error.stack) console.error(error.stack);
    }
    process.exit(1);
  }
}

main();