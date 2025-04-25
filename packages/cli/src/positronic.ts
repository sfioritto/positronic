#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ProjectCommand } from './commands/project.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import * as fsPromises from 'fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { RunCommand } from './commands/run.js';
import { ServerCommand } from './commands/server.js';

function findProjectRootSync(startDir: string): string | null {
    let currentDir = path.resolve(startDir);
    while (true) {
        const configPath = path.join(currentDir, 'positronic.config.json');
        try {
            fs.accessSync(configPath);
            return currentDir;
        } catch (e) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                return null;
            }
            currentDir = parentDir;
        }
    }
}

// Determine mode and project path once at the start
const projectRootPath = findProjectRootSync(process.cwd());
const isLocalDevMode = !!projectRootPath;

// Helper to resolve template paths relative to the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assuming templates are inside the cli package at packages/cli/templates
// Compiled file likely at packages/cli/dist/positronic.js
// Need to go up 1 level to packages/cli/, then into templates/
const templatesBaseDir = path.resolve(__dirname, '../templates');
const cloudflareDevServerTemplateDir = path.join(templatesBaseDir, 'cloudflare-dev-server');
const workflowTemplateDir = path.join(templatesBaseDir, 'workflow'); // Added for workflow new

// Instantiate command classes, passing the determined mode and path
const projectCommand = new ProjectCommand(isLocalDevMode);
const runCommand = new RunCommand(isLocalDevMode);
const serverCommand = new ServerCommand(cloudflareDevServerTemplateDir);

// Main CLI definition
let cli = yargs(hideBin(process.argv))
  .scriptName('positronic')
  .usage('Usage: $0 <command> [options]')
  .version()
  .alias('v', 'version')
  .help('h')
  .alias('h', 'help')
  .wrap(null)
  .strictCommands()

// --- Project Management Commands (Global Mode Only) ---
cli = cli.command('project', 'Manage your Positronic projects\n', (yargsProject) => {
  if (!isLocalDevMode) {
    yargsProject
      .command(
        'new <project-name>',
        'Create a new Positronic project directory',
        (yargsNew) => {
            return yargsNew
                .positional('project-name', {
                    describe: 'Name of the new project directory to create',
                    type: 'string',
                    demandOption: true
                });
        },
        (argv) => projectCommand.create(argv)
      )
  }

  yargsProject
    .command(
      'add <name>',
      'Add a project to your list of projects',
      (yargsAdd) => {
        return yargsAdd
          .positional('name', {
            describe: 'Name for the project',
            type: 'string',
            demandOption: true,
          })
          .option('url', {
            describe: 'Project API URL',
            type: 'string',
            demandOption: true,
          })
          .example('$0 project add my-project --url https://api.my-project.positronic.sh', 'Add a project configuration');
      },
      (argv) => projectCommand.add(argv)
    )
    .command(
      'select [name]',
      'Switch the active project',
      (yargsSelect) => {
        return yargsSelect
          .positional('name', {
            describe: 'Project name to select',
            type: 'string'
          })
          .example('$0 project select my-project', 'Switch the active project')
          .example('$0 project select', 'Interactive project selection');
      },
      (argv) => projectCommand.select(argv)
    )
    .command(
      'list',
      'List all of your Positronic projects',
      () => {},
      () => projectCommand.list()
    )
    .command(
      'show',
      'Display your currently selected project',
      () => {},
      () => projectCommand.show()
    )
    .demandCommand(1, 'You need to specify a project command (add, select, list, show) in Local Dev Mode.');

  return yargsProject;
});

// --- Add the 'new' command alias (Global Mode Only) ---
if (!isLocalDevMode) {
  cli = cli.command(
    'new <project-name>',
    'Alias for `project new`. Create a new Positronic project directory.\n',
    (yargsNewAlias) => {
        return yargsNewAlias
            .positional('project-name', {
                describe: 'Name of the new project directory to create',
                type: 'string',
                demandOption: true
            });
    },
    (argv) => projectCommand.create(argv) // Reuse the same handler
  );
}

// --- Add the Server Command ---
// The server command should only be available in local dev mode;
// Wrap its registration in the check
if (isLocalDevMode) {
  cli = cli.command(
    ['server', 's'],
    'Start the local development server for the current project',
    (yargsServer) => {
      return yargsServer
        .option('force', {
            describe: 'Force regeneration of the .positronic server directory',
            type: 'boolean',
            default: false,
        });
    },
    (argv) => serverCommand.handle(argv, projectRootPath)
  );
}

// --- Workflow Management Commands ---
cli = cli.command('workflow', 'Workflows are step-by-step scripts that run TypeScript code created by you Workflows can use agents, prompts, resources, and services.\n', (yargs) => {
  yargs
    .command('list', 'List all workflows in the active project\n', () => {})
    .command('history <workflow-name>', 'List recent runs of a specific workflow\n', (yargs) => {
      return yargs
        .positional('workflow-name', {
          describe: 'Name of the workflow',
          type: 'string',
          demandOption: true
        })
        .option('limit', {
          describe: 'Maximum number of runs to show',
          type: 'number',
          default: 10
        })
        .example('$0 workflow history my-workflow', 'List recent runs for my-workflow')
        .example('$0 workflow history my-workflow --limit=20', 'List more recent runs');
    }, handleWorkflowHistory)
    .command('show <workflow-name>', 'List all steps and other details for the workflow\n', (yargs) => {
      return yargs
        .positional('workflow-name', {
          describe: 'Name of the workflow',
          type: 'string',
          demandOption: true
        });
    })
    .command('rerun <workflow-name> [workflow-run-id]', 'Rerun an existing workflow run\n', (yargs) => {
      return yargs
        .positional('workflow-name', {
          describe: 'Name of the workflow',
          type: 'string',
          demandOption: true
        })
        .positional('workflow-run-id', {
          describe: 'ID of the workflow run to rerun (defaults to the most recent run)',
          type: 'string'
        })
        .option('starts-at', {
          describe: 'Step number to start execution from',
          type: 'number'
        })
        .alias('starts-at', 's')
        .option('stops-after', {
          describe: 'Step number to stop execution after',
          type: 'number'
        })
        .alias('stops-after', 'e')
        .option('verbose', {
          describe: 'Show verbose output',
          type: 'boolean',
        })
        .example('$0 workflow rerun my-workflow', 'Rerun the most recent execution of my-workflow')
        .example('$0 workflow rerun my-workflow abc123', 'Rerun a specific workflow run')
        .example('$0 workflow rerun my-workflow --starts-at=3', 'Rerun from step 3')
        .example('$0 workflow rerun my-workflow --stops-after=5', 'Rerun and stop after step 5')
        .example('$0 workflow rerun my-workflow --starts-at=3 --stops-after=5', 'Rerun steps 3 through 5')
        .example('$0 workflow rerun my-workflow --verbose', 'Rerun with verbose output');
    }, handleWorkflowRerun)
    .command('run <workflow-name>', 'Run a workflow\n', (yargs) => {
      return yargs
        .positional('workflow-name', {
          describe: 'Name of the workflow',
          type: 'string',
          demandOption: true
        })
        .option('verbose', {
          describe: 'Show verbose output',
          type: 'boolean',
        })
        .example('$0 workflow run my-workflow', 'Run a workflow by name')
        .example('$0 workflow run my-workflow --verbose', 'Run a workflow with verbose output');
    }, handleWorkflowRun)
    .command('watch <workflow-name>', 'Watch a specific workflow run for live updates\n', (yargs) => {
      return yargs
        .positional('workflow-name', {
          describe: 'Name of the workflow',
          type: 'string',
          demandOption: true
        })
        .option('run-id', {
          describe: 'ID of the workflow run to watch',
          type: 'string',
          demandOption: true,
          alias: 'id'
        })
        .example('$0 workflow watch my-workflow --run-id abc123', 'Watch the workflow run with ID abc123');
    }, handleWorkflowWatch)

  if (isLocalDevMode) {
    yargs.command('new <workflow-name>', 'Create a new workflow in the current project', (yargsNew) => {
      return yargsNew
        .positional('workflow-name', {
          describe: 'Name of the new workflow'
        })
        .option('prompt', {
          describe: 'Prompt to use for generating the workflow',
          type: 'string',
          alias: 'p'
        })
        .example('$0 workflow new my-workflow', 'Create a new workflow in the current project directory')
        .example('$0 workflow new my-workflow -p "Generate a workflow for data processing"', 'Create a workflow using a prompt');
    }, handleWorkflowNew);
  }

  return yargs.demandCommand(1, 'You need to specify a workflow command');
})

// --- Agent Management Commands ---
cli = cli.command('agent', 'Agents have tools, resources and an objective. They can have a human in the loop.\n', (yargs) => {
  yargs
    .command('list', 'List all agents in the active project\n', () => { })
    .command('show <agent-name>', 'Show details and usage statistics for a specific agent\n', (yargs) => {
      return yargs
        .positional('agent-name', {
          describe: 'Name of the agent',
          type: 'string',
          demandOption: true
        });
    })
    .command('history <agent-name>', 'List recent history of a specific agent\n', (yargs) => {
      return yargs
        .positional('agent-name', {
          describe: 'Name of the agent',
          type: 'string',
          demandOption: true
        });
    })
    .command('run <agent-name>', 'Run an agent\n', (yargs) => {
      return yargs
        .positional('agent-name', {
          describe: 'Name of the agent',
          type: 'string',
          demandOption: true
        })
        .option('verbose', {
          describe: 'Show verbose output',
          type: 'boolean',
        })
        .example('$0 agent run my-agent', 'Run an agent by name')
        .example('$0 agent run my-agent --verbose', 'Run an agent with verbose output');
    }, handleAgentRun)

  if (isLocalDevMode) {
    yargs.command('new <agent-name>', 'Create a new agent in the current project', (yargsNew) => {
      return yargsNew
        .positional('agent-name', {
          describe: 'Name of the new agent'
        })
        .option('prompt', {
          describe: 'Prompt to use for generating the agent',
          type: 'string',
          alias: 'p'
        })
        .example('$0 agent new my-agent', 'Create a new agent in the current project directory')
        .example('$0 agent new my-agent -p "Generate a customer service agent"', 'Create an agent using a prompt');
    }, handleAgentNew);
  }

  yargs.command('watch <agent-name>', 'Watch a specific agent run for live updates\n', (yargs) => {
    return yargs
      .positional('agent-name', {
        describe: 'Name of the agent',
        type: 'string',
        demandOption: true
      })
      .option('run-id', {
        describe: 'ID of the agent run to watch',
        type: 'string',
        demandOption: true,
        alias: 'id'
      })
      .example('$0 agent watch my-agent --run-id def456', 'Watch the agent run with ID def456');
  }, handleAgentWatch);

  return yargs.demandCommand(1, 'You need to specify an agent command');
})

// --- Prompt Management Commands ---
cli = cli.command('prompt', 'Prompts are a one-shot call to an LLM with a typed return with no human in the loop (see agents for that) that you can use in your workflows.\n', (yargs) => {
  yargs
    .command('list', 'List all prompts in the active project\n', () => {}, handlePromptList)
    .command('show <prompt-name>', 'Show prompt details including usage statistics\n', (yargs) => {
      return yargs
        .positional('prompt-name', {
          describe: 'Name of the prompt',
          type: 'string',
          demandOption: true
        })
        .example('$0 prompt show my-prompt', 'Show usage statistics for my-prompt');
    }, handlePromptShow)

  // Command available ONLY in Local Dev Mode
  if (isLocalDevMode) {
    yargs.command('new <prompt-name>', 'Create a new prompt in the current project', (yargsNew) => {
      return yargsNew
        .positional('prompt-name', {
          describe: 'Name of the new prompt'
        })
        .example('$0 prompt new my-prompt', 'Create a new prompt file in the current project directory');
    }, handlePromptNew);
  }

  return yargs.demandCommand(1, 'You need to specify a prompt command');
})

// --- Resource Management Commands ---
cli = cli.command('resource', 'Resources are any data that can be used in your workflows, agents, and prompts. They can be text or binaries.\n', (yargs) => {
  return yargs
    .command('list', 'List all resources in the active project\n', () => {}, handleResourceList)
    .demandCommand(1, 'You need to specify a resource command');
})

// --- Service Management Commands ---
cli = cli.command('service', 'Services are code that can be injected into your workflows and available in every Step.\n', (yargs) => {
  return yargs
    .command('list', 'List all services in the active project\n', () => {}, handleServiceList)
    .demandCommand(1, 'You need to specify a service command');
})

// --- Execution Commands ---
cli = cli.command('run <name-or-path>', 'Run a workflow or agent\n', (yargsRun) => {
  return yargsRun
    .positional('name-or-path', {
      describe: 'Name of the workflow/agent to run',
      type: 'string',
      demandOption: true
    })
    // Options like --workflow, --agent might be fine
    .option('workflow', {
      describe: 'Explicitly specify workflow name',
      type: 'string',
    })
    .option('agent', {
      describe: 'Explicitly specify agent name',
      type: 'string',
    })
    .option('starts-at', {
      describe: 'Start workflow from specific step (requires --workflow)',
      type: 'number',
    })
    .alias('starts-at', 's')
    .option('stops-after', {
      describe: 'Stop workflow after specific step (requires --workflow)',
      type: 'number',
    })
    .alias('stops-after', 'e')
    .option('verbose', {
      describe: 'Show verbose output',
      type: 'boolean',
    })
    // Rules: starts-at and stops-after require workflow to be specified
    .implies('starts-at', 'workflow')
    .implies('stops-after', 'workflow')
    .example('$0 run my-workflow', 'Run a workflow by name')
    .example('$0 run --workflow my-workflow', 'Explicitly run a workflow')
    .example('$0 run --agent my-agent', 'Explicitly run an agent')
    .example('$0 run --workflow my-workflow --starts-at=3 --verbose', 'Run workflow starting at step 3')
    .example('$0 run --workflow my-workflow -s 3 -e 5', 'Run workflow steps 3 through 5');
}, (argv) => runCommand.handle(argv));

// --- Global List Command ---
cli = cli.command(
  'list',
  'List entities (workflows, agents, etc.) in the current project',
  (yargsList) => {
    return yargsList
      .option('type', {
        describe: 'Filter by entity type (can be specified multiple times)',
        choices: ['workflow', 'agent', 'resource', 'prompt', 'service', 'all'],
        default: 'all',
        array: true
      })
      .example('$0 list', 'List all workflows, agents, resources, prompts and services in the current project')
      .example('$0 list --type workflow', 'List workflows')
      .example('$0 list --type agent', 'List agents')
      .example('$0 list --type workflow --type agent', 'List both workflows and agents')
      .example('$0 list --type resource', 'List resources')
      .example('$0 list --type prompt', 'List prompts')
      .example('$0 list --type service', 'List services');
  }, handleGlobalList);

cli = cli.epilogue('For more information, visit https://positronic.sh');

// Parse the arguments
cli.parse();

function handleGlobalList(argv: any) {
  const context = isLocalDevMode ? `local project at ${projectRootPath}` : 'selected remote project';
  if (argv.type.includes('all')) {
    console.log(`Listing all entity types in ${context}`);
  } else {
    console.log(`Listing entities of types: ${argv.type.join(', ')} in ${context}`);
  }
  // TODO: Implement actual listing logic, querying either local file system or remote API
}

// Add handler for workflow new command
function handleWorkflowNew(argv: any) {
  if (!projectRootPath) {
    console.error("Error: Cannot create workflow outside of a project directory.");
    process.exit(1);
  }
  const workflowName = argv.workflowName;
  const workflowFileName = `${workflowName}.ts`;
  const workflowsDir = path.join(projectRootPath, 'workflows');
  const destinationPath = path.join(workflowsDir, workflowFileName);
  const templatePath = path.join(workflowTemplateDir, 'new.ts.tpl');

  console.log(`Creating new workflow '${workflowName}' in ${workflowsDir}...`);

  fsPromises.mkdir(workflowsDir, { recursive: true })
    .then(() => fsPromises.copyFile(templatePath, destinationPath))
    .then(() => {
      console.log(`Workflow file created: ${destinationPath}`);
      // Optionally open the file in an editor or provide further instructions
    })
    .catch((err) => {
      console.error(`Error creating workflow file:`, err);
      process.exit(1);
    });
}

// Add handler for agent new command
function handleAgentNew(argv: any) {
  // This check is now implicitly handled by the command only being available in local mode
  if (!isLocalDevMode) { // Keep check for clarity or future changes
      console.error("Internal Error: Agent new command executed in non-local mode.");
      process.exit(1);
  }
  console.log(`Creating new agent in project ${projectRootPath}: ${argv['agent-name']}${argv.prompt ? ` using prompt: ${argv.prompt}` : ''}`);
  // TODO: Implement agent creation logic within projectRootPath
}

// Add handler for agent run command
function handleAgentRun(argv: any) {
  const agentName = argv['agent-name'];
  const verbose = argv.verbose ? ' with verbose output' : '';

  console.log(`Running agent: ${agentName}${verbose}`);
  // TODO: Implement agent run logic (API call to local/remote server)
}

// Add handlers for the prompt commands
function handlePromptNew(argv: any) {
  // This check is now implicitly handled by the command only being available in local mode
  if (!isLocalDevMode) { // Keep check for clarity or future changes
      console.error("Internal Error: Prompt new command executed in non-local mode.");
      process.exit(1);
  }
  console.log(`Creating new prompt in project ${projectRootPath}: ${argv['prompt-name']}`);
  // TODO: Implement prompt creation logic within projectRootPath
}

function handlePromptList() {
  console.log('Listing all prompts');
}

function handlePromptShow(argv: any) {
  console.log(`Showing prompt details for: ${argv['prompt-name']} including usage statistics`);
}

// Add handlers for the resource commands
function handleResourceList() {
  console.log('Listing all resources');
}

// Add handlers for the service commands
function handleServiceList() {
  console.log('Listing all services');
}

// Add handler for workflow rerun command
function handleWorkflowRerun(argv: any) {
  const workflowName = argv['workflow-name'];
  const workflowRunId = argv['workflow-run-id'] || 'most recent run';
  const startsAt = argv['starts-at'] ? ` starting at step ${argv['starts-at']}` : '';
  const stopsAfter = argv['stops-after'] ? ` stopping after step ${argv['stops-after']}` : '';
  const verbose = argv.verbose ? ' with verbose output' : '';

  console.log(`Rerunning workflow: ${workflowName} (run: ${workflowRunId})${startsAt}${stopsAfter}${verbose}`);
}

// Add handler for workflow run command
function handleWorkflowRun(argv: any) {
  const workflowName = argv['workflow-name'];
  const verbose = argv.verbose ? ' with verbose output' : '';

  console.log(`Running workflow: ${workflowName}${verbose}`);
}

// Add handler for workflow history command
function handleWorkflowHistory(argv: any) {
  const workflowName = argv['workflow-name'];
  const limit = argv.limit;

  console.log(`Listing ${limit} recent runs for workflow: ${workflowName} (including output and state information)`);
  // Here we would implement:
  // 1. Query for recent workflow runs for the specified workflow
  // 2. Display in a table format: Run ID, Start Time, Duration, Status
  // 3. Include truncated output and state information for each run
}

// Add handler for workflow watch command
function handleWorkflowWatch(argv: any) {
  const workflowName = argv['workflow-name'];
  const runId = argv['run-id'];
  console.log(`Watching workflow: ${workflowName}, Run ID: ${runId}`);
  // TODO: Implement SSE connection logic
}

// Add handler for agent watch command
function handleAgentWatch(argv: any) {
  const agentName = argv['agent-name'];
  const runId = argv['run-id'];
  console.log(`Watching agent: ${agentName}, Run ID: ${runId}`);
  // TODO: Implement SSE connection logic
}