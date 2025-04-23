#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ProjectCommand } from './commands/project.js';
import * as fs from 'fs'; // Use synchronous fs methods
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as fsPromises from 'fs/promises'; // Keep for async operations where needed

// Environment Variable for Mode Detection:
// POSITRONIC_PROJECT_PATH: If this environment variable is set, the CLI operates in
// "Local Development Mode", targeting the project specified by the path.
// All operations assume the context of this local project, and commands interact
// with a local development server (e.g., http://localhost:8080). Project selection is disabled.
// If this variable is NOT set, the CLI operates in "Global Mode", interacting
// with remote projects configured via `project add`.

// Synchronous function to find project root
function findProjectRootSync(startDir: string): string | null {
    let currentDir = path.resolve(startDir);
    while (true) {
        const configPath = path.join(currentDir, 'positronic.config.json');
        try {
            fs.accessSync(configPath); // Use synchronous access check
            return currentDir; // Found it
        } catch (e) {
            // Not found, go up
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached root
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

// Instantiate command classes, passing the determined mode and path
const projectCommand = new ProjectCommand(isLocalDevMode, projectRootPath);

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
  .demandCommand(1, 'You need to specify a command');

// --- Project Management Commands (Global Mode Only) ---
cli = cli.command('project', 'Manage your Positronic projects\n', (yargsProject) => {
  if (!isLocalDevMode) {
    // Only 'new' is available in Global Mode
    yargsProject
      .command(
        'new <project-name>',
        'Create a new Positronic project directory',
        (yargsNew) => {
            // This command creates the project structure locally, including `bin/positronic`
            return yargsNew
                .positional('project-name', {
                    describe: 'Name of the new project directory to create',
                    type: 'string',
                    demandOption: true
                });
        },
        (argv) => projectCommand.create(argv)
      )
      .demandCommand(1, 'In Global Mode, only the \'new\' project command is available.');
  } else {
    // add, select, list, show are available in Local Dev Mode
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
  }

  return yargsProject;
});

// --- Add the 'new' command alias (Global Mode Only) ---
if (!isLocalDevMode) {
  cli = cli.command(
    'new <project-name>',
    'Alias for `project new`. Create a new Positronic project directory.',
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
    handleServer // Handler already checks for project root
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
}, handleRun);

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

function handleRun(argv: any) {
  console.log(`Running: ${argv['name-or-path']}`);
}

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
  if (!isLocalDevMode) {
    console.error("Error: Cannot create new workflows in Global Mode. Use `positronic workflow new ...` within your project directory.");
    process.exit(1);
  }
  // Now we know we are in Local Dev Mode
  console.log(`Creating new workflow in project ${projectRootPath}: ${argv['workflow-name']}${argv.prompt ? ` using prompt: ${argv.prompt}` : ''}`);
  // TODO: Implement workflow creation logic within projectRootPath
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

// ------------------- Handler Implementations -------------------

// Helper to find project root (Keep async version for server command)
async function findProjectRoot(startDir: string): Promise<string | null> {
    let currentDir = path.resolve(startDir);
    while (true) {
        const configPath = path.join(currentDir, 'positronic.config.json');
        try {
            // Use fsPromises for the async version
            await fsPromises.access(configPath);
            return currentDir; // Found it
        } catch (e) {
            // Not found, go up
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached root
                return null;
            }
            currentDir = parentDir;
        }
    }
}

// Helper function to copy and process a template file for the server
async function copyServerTemplate(
    templateFileName: string,
    destinationDir: string,
    destinationFileName: string, // Allow different destination name
    projectName: string,
    userCoreVersion: string | null // Added parameter
): Promise<void> {
    const templatePath = path.join(cloudflareDevServerTemplateDir, templateFileName);
    const destinationPath = path.join(destinationDir, destinationFileName);
    try {
        let content = await fsPromises.readFile(templatePath, 'utf-8');

        // Process {{projectName}} placeholder first
        content = content.replace(/{{projectName}}/g, projectName);

        // Special handling for package.json
        if (templateFileName === 'package.json.tpl') {
            const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH; // Renamed internally, expecting root path now

            // Priority 1: Inject local development paths if env var is set
            if (devRootPath) {
                console.log(` -> Injecting local development paths relative to ${devRootPath} into package.json...`);
                try {
                    const packageJson = JSON.parse(content);
                    // Construct paths relative to the provided root path
                    const coreDevPath = path.join(devRootPath, 'packages', 'core');
                    const cloudflareDevPath = path.join(devRootPath, 'packages', 'cloudflare');

                    if (packageJson.dependencies && packageJson.dependencies['@positronic/core']) {
                        packageJson.dependencies['@positronic/core'] = `file:${coreDevPath}`;
                        console.log(`    - Using local @positronic/core: file:${coreDevPath}`);
                    }
                    if (packageJson.dependencies && packageJson.dependencies['@positronic/cloudflare']) {
                        packageJson.dependencies['@positronic/cloudflare'] = `file:${cloudflareDevPath}`;
                        console.log(`    - Using local @positronic/cloudflare: file:${cloudflareDevPath}`);
                    }
                    content = JSON.stringify(packageJson, null, 2);
                } catch (parseError: any) {
                     console.error(`   Error parsing server template ${templateFileName} for local path injection: ${parseError.message}`);
                     throw parseError;
                }
            }
            // Priority 2: Sync versions from user project if dev path is NOT set
            else if (userCoreVersion) {
                console.log(` -> Syncing @positronic/* versions to user project version: ${userCoreVersion}...`);
                 try {
                    const packageJson = JSON.parse(content);
                    let updated = false;

                    if (packageJson.dependencies && packageJson.dependencies['@positronic/core']) {
                        packageJson.dependencies['@positronic/core'] = userCoreVersion;
                        console.log(`    - Set @positronic/core to ${userCoreVersion}`);
                        updated = true;
                    }
                    if (packageJson.dependencies && packageJson.dependencies['@positronic/cloudflare']) {
                        packageJson.dependencies['@positronic/cloudflare'] = userCoreVersion;
                        console.log(`    - Set @positronic/cloudflare to ${userCoreVersion}`);
                         updated = true;
                    }

                    if (updated) {
                         content = JSON.stringify(packageJson, null, 2);
                    } else {
                         console.log(`    - No matching @positronic/* dependencies found in template to update.`);
                    }
                } catch (parseError: any) {
                     console.error(`   Error parsing server template ${templateFileName} for version syncing: ${parseError.message}`);
                     throw parseError;
                }
            }
             // Priority 3: Use default template versions if no dev path and no user version found
             // (No code needed here, just falls through)
        }

        // Write the final content (potentially modified)
        await fsPromises.writeFile(destinationPath, content);
        console.log(`   Created ${destinationFileName}`);

    } catch (error: any) {
        console.error(`   Error processing server template ${templateFileName}: ${error.message}`);
        throw error; // Re-throw to stop the process
    }
}

// Helper to run npm install
function runNpmInstall(targetDir: string): Promise<void> {
     console.log(` -> Running npm install in ${targetDir}...`);
    const npmInstall = spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: true
    });

    return new Promise((resolve, reject) => {
        npmInstall.on('close', (code) => {
            if (code === 0) {
                console.log(` -> npm install completed successfully.`);
                resolve();
            } else {
                console.error(` -> npm install failed with code ${code}.`);
                reject(new Error(`npm install failed in ${targetDir}`));
            }
        });
        npmInstall.on('error', (err) => {
            console.error(` -> Failed to start npm install in ${targetDir}:`, err);
            reject(err);
        });
    });
}

// --- Server Command Handler ---
async function handleServer(argv: any): Promise<void> {
    console.log('Starting Positronic development server...');

    // 1. Find Project Root (Can keep using the async version here)
    // Or use the already found projectRootPath if available?
    // Using the async check here ensures it runs correctly even if CWD changes,
    // and matches the previous logic exactly for this command.
    const currentProjectRoot = await findProjectRoot(process.cwd());
    if (!currentProjectRoot) {
        console.error("Error: Not inside a Positronic project. Could not find 'positronic.config.json'.");
        console.error("Run 'positronic project new <name>' first or ensure you are in the project directory.");
        process.exit(1);
    }
    // Can optionally compare currentProjectRoot with the initially found projectRootPath
    // if (currentProjectRoot !== projectRootPath) {
    //     console.warn("Warning: Current directory seems outside the initial project root detected.");
    // }
    console.log(`Found project root: ${currentProjectRoot}`);

    // 2. Read Config & User Package (Use currentProjectRoot found by this handler)
    const configPath = path.join(currentProjectRoot, 'positronic.config.json');
    const userPackagePath = path.join(currentProjectRoot, 'package.json');
    let config: any;
    let userPackageJson: any;
    let userCoreVersion: string | null = null;

    try {
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
    } catch (error: any) {
        console.error(`Error reading or parsing ${configPath}: ${error.message}`);
        process.exit(1);
    }

    try {
        const userPackageContent = await fsPromises.readFile(userPackagePath, 'utf-8');
        userPackageJson = JSON.parse(userPackageContent);
        userCoreVersion = userPackageJson?.dependencies?.['@positronic/core'] || null;
        if (userCoreVersion) {
             console.log(`Detected user project @positronic/core version: ${userCoreVersion}`);
        } else {
             console.warn(`Warning: Could not find @positronic/core in user project dependencies (${userPackagePath}). Default versions will be used in .positronic.`);
        }
    } catch (error: any) {
        console.warn(`Warning: Could not read user project package.json at ${userPackagePath}: ${error.message}`);
        console.warn(' -> Default versions will be used in .positronic.');
    }

    const projectName = config?.projectName || 'positronic-project'; // Fallback name

    // 3. Check Backend Type
    if (config?.backend?.type !== 'cloudflare') {
        console.error(`Error: Unsupported backend type '${config?.backend?.type}'. Currently, only 'cloudflare' is supported for the local server.`);
        process.exit(1);
    }

    // 4. Define .positronic Path (Use currentProjectRoot found by this handler)
    const dotPositronicPath = path.join(currentProjectRoot, '.positronic');
    const dotPositronicSrcPath = path.join(dotPositronicPath, 'src');

    // 5. Check if .positronic needs generation
    let needsGeneration = false;
    try {
        await fsPromises.access(dotPositronicPath);
        if (argv.force) {
             console.log('Force flag detected, regenerating .positronic directory...');
             needsGeneration = true;
             // Clean up old dir first if forcing regeneration
             try {
                 await fsPromises.rm(dotPositronicPath, { recursive: true, force: true });
             } catch (rmError: any) {
                 console.warn(`Warning: Could not completely remove old .positronic directory: ${rmError.message}`);
             }
        } else {
            console.log(`Found existing .positronic directory. Use --force to regenerate.`);
            // Optional: Add more checks here, e.g., check if package.json exists, or node_modules
        }
    } catch (e) {
        // Doesn't exist, needs generation
        needsGeneration = true;
    }

    // 6. Generate .positronic if needed
    if (needsGeneration) {
        console.log('Setting up local Cloudflare dev server in .positronic...');
        try {
            await fsPromises.mkdir(dotPositronicPath, { recursive: true });
            await fsPromises.mkdir(dotPositronicSrcPath, { recursive: true });
            console.log(' -> Created .positronic directories.');

            console.log(' -> Copying server template files...');
            // Pass userCoreVersion only to package.json template processing
            await copyServerTemplate('package.json.tpl', dotPositronicPath, 'package.json', projectName, userCoreVersion);
            await copyServerTemplate('wrangler.jsonc.tpl', dotPositronicPath, 'wrangler.jsonc', projectName, null);
            await copyServerTemplate('tsconfig.json.tpl', dotPositronicPath, 'tsconfig.json', projectName, null);
            await copyServerTemplate('src/index.ts.tpl', dotPositronicSrcPath, 'index.ts', projectName, null);

            // Run npm install within .positronic
            await runNpmInstall(dotPositronicPath);

        } catch (error: any) {
            console.error(`Error setting up .positronic directory: ${error.message}`);
            // Attempt cleanup on failure
            try { await fsPromises.rm(dotPositronicPath, { recursive: true, force: true }); } catch {}
            process.exit(1);
        }
        console.log('.positronic setup complete.');
    }

    // 7. Run Wrangler Dev
    console.log('Starting Cloudflare development server via Wrangler...');
    console.log(`(Running 'npx wrangler dev' in ${dotPositronicPath})`);

    const wranglerDev = spawn('npx', ['wrangler', 'dev'], {
        cwd: dotPositronicPath,
        stdio: 'inherit', // Pipe stdin, stdout, stderr to user
        shell: true // Helps find npx/wrangler
    });

    wranglerDev.on('close', (code) => {
        // If wrangler exits cleanly (e.g., user presses Ctrl+C), code might be null or 0
        // If it crashes, it might be non-zero.
        if (code !== null && code !== 0) {
             console.log(`Wrangler dev server exited unexpectedly with code ${code}.`);
        } else {
             console.log('Wrangler dev server stopped.');
        }
         // Exit the CLI process itself once wrangler is done
         process.exit(code ?? 0);
    });

    wranglerDev.on('error', (err) => {
        console.error('Failed to start Wrangler dev server process:', err);
        console.error('Ensure Wrangler is installed correctly (`npm install -D wrangler` in .positronic or globally) and accessible in your PATH.');
        process.exit(1);
    });

    // Keep the process alive while wrangler is running. The exit logic is handled in the 'close' event.
    // We might need to handle SIGINT/SIGTERM explicitly to gracefully shut down wrangler if needed,
    // but stdio: 'inherit' often handles Ctrl+C correctly.
}
