#!/usr/bin/env node --disable-warning=ExperimentalWarning --loader ts-node/esm --experimental-specifier-resolution=node

import path from 'path';
import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteAdapter } from '@positronic/adapter-sqlite';
import { WorkflowRunner, STATUS, LocalFileStore } from '@positronic/core';
import { AnthropicClient } from '@positronic/client-anthropic';
import type { SerializedStep } from '@positronic/core';

interface CliOptions {
  workflowDir?: string;
  stateFile?: string;
  verbose?: boolean;
  restartFrom?: number;
  runId?: string;
  listRuns?: boolean;
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

function parseArgs(): CliOptions & { workflowPath?: string } {
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
        case 'run-id':
          options.runId = arg.split('=')[1];
          break;
        case 'list-runs':
          options.listRuns = true;
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

async function main() {
  try {
    const { workflowPath, workflowDir, stateFile, verbose, restartFrom, runId, listRuns } = parseArgs();
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
      throw new Error('Workflow path is required unless using --list-runs');
    }

    const fullPath = workflowDir
      ? path.resolve(process.cwd(), workflowDir, workflowPath)
      : path.resolve(process.cwd(), workflowPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Workflow file not found: ${fullPath}. CWD: ${process.cwd()}`);
    }

    const workflow = await loadTypeScriptWorkflow(fullPath);
    if (!workflow || workflow.type !== 'workflow') {
      throw new Error(`File ${workflowPath} does not export a workflow as default export: ${workflow.type}`);
    }

    const initialState = await loadState(stateFile);

    let completedSteps: SerializedStep[] = [];
    let workflowRunId: string | undefined;

    if (restartFrom !== undefined) {
      if (!runId) {
        throw new Error('--run-id is required when using --restartFrom');
      }

      const lastRun = await getLastWorkflowRun(db, runId);
      if (!lastRun) {
        throw new Error(`No run found with ID: ${runId}`);
      }

      const stepsToKeep = restartFrom - 1;
      completedSteps = lastRun.completedSteps.slice(0, stepsToKeep);
      workflowRunId = lastRun.runId;

      if (completedSteps.length < stepsToKeep) {
        throw new Error(`Workflow only has ${completedSteps.length} steps, cannot restart from step ${restartFrom}`);
      }
    }

    const currentWorkflowDir = path.dirname(fullPath);

    const runner = new WorkflowRunner({
      adapters: [new SQLiteAdapter(db)],
      logger: console,
      verbose: !!verbose,
      client: new AnthropicClient(),
      fileStore: new LocalFileStore(currentWorkflowDir)
    });

    await runner.run(workflow, {
      initialState,
      initialCompletedSteps: completedSteps,
      workflowRunId
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error('Failed to run workflow:', error.message);
      if (error.stack) console.error(error.stack);
    }
    process.exit(1);
  }
}

main();