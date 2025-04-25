#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ProjectCommand } from './commands/project.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RunCommand } from './commands/run.js';
import { ServerCommand } from './commands/server.js';
import { PromptCommand } from './commands/prompt.js';
import { BrainCommand } from './commands/brain.js';

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
const brainTemplateDir = path.join(templatesBaseDir, 'brain');

// Instantiate command classes, passing the determined mode and path
const projectCommand = new ProjectCommand(isLocalDevMode);
const runCommand = new RunCommand(isLocalDevMode);
const serverCommand = new ServerCommand(cloudflareDevServerTemplateDir);
const brainCommand = new BrainCommand(isLocalDevMode, projectRootPath, brainTemplateDir);
const promptCommand = new PromptCommand(isLocalDevMode, projectRootPath);

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

// --- Brain Management Commands ---
cli = cli.command('brain', '🧠 Manage Brains: the core executable units you define to build your Positronic project.\n', (yargs) => {
  yargs
    .command('list', 'List all brains in the active project\n', () => {}, (argv) => brainCommand.list(argv))
    .command('history <brain-name>', 'List recent runs of a specific brain\n', (yargsHistory) => {
      return yargsHistory
        .positional('brain-name', {
          describe: 'Name of the brain',
          type: 'string',
          demandOption: true
        })
        .option('limit', {
          describe: 'Maximum number of runs to show',
          type: 'number',
          default: 10
        })
        .example('$0 brain history my-brain', 'List recent runs for my-brain')
        .example('$0 brain history my-brain --limit=20', 'List more recent runs');
    }, (argv) => brainCommand.history(argv))
    .command('show <brain-name>', 'List all steps and other details for the brain\n', (yargsShow) => {
      return yargsShow
        .positional('brain-name', {
          describe: 'Name of the brain',
          type: 'string',
          demandOption: true
        });
    }, (argv) => brainCommand.show(argv))
    .command('rerun <brain-name> [brain-run-id]', 'Rerun an existing brain run\n', (yargsRerun) => {
      return yargsRerun
        .positional('brain-name', {
          describe: 'Name of the brain',
          type: 'string',
          demandOption: true
        })
        .positional('brain-run-id', {
          describe: 'ID of the brain run to rerun (defaults to the most recent run)',
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
        .example('$0 brain rerun my-brain', 'Rerun the most recent execution of my-brain')
        .example('$0 brain rerun my-brain abc123', 'Rerun a specific brain run')
        .example('$0 brain rerun my-brain --starts-at=3', 'Rerun from step 3')
        .example('$0 brain rerun my-brain --stops-after=5', 'Rerun and stop after step 5')
        .example('$0 brain rerun my-brain --starts-at=3 --stops-after=5', 'Rerun steps 3 through 5')
        .example('$0 brain rerun my-brain --verbose', 'Rerun with verbose output');
    }, (argv) => brainCommand.rerun(argv))
    .command('run <brain-name>', 'Run a brain\n', (yargsRun) => {
      return yargsRun
        .positional('brain-name', {
          describe: 'Name of the brain',
          type: 'string',
          demandOption: true
        })
        .option('verbose', {
          describe: 'Show verbose output',
          type: 'boolean',
        })
        .example('$0 brain run my-brain', 'Run a brain by name')
        .example('$0 brain run my-brain --verbose', 'Run a brain with verbose output');
    }, (argv) => brainCommand.run(argv))
    .command('watch <brain-name>', 'Watch a specific brain run for live updates\n', (yargsWatch) => {
      return yargsWatch
        .positional('brain-name', {
          describe: 'Name of the brain',
          type: 'string',
          demandOption: true
        })
        .option('run-id', {
          describe: 'ID of the brain run to watch',
          type: 'string',
          demandOption: true,
          alias: 'id'
        })
        .example('$0 brain watch my-brain --run-id abc123', 'Watch the brain run with ID abc123');
    }, (argv) => brainCommand.watch(argv))

  if (isLocalDevMode) {
    yargs.command('new <brain-name>', 'Create a new brain in the current project', (yargsNew) => {
      return yargsNew
        .positional('brain-name', {
          describe: 'Name of the new brain',
          type: 'string',
          demandOption: true
        })
        .option('prompt', {
          describe: 'Prompt to use for generating the brain',
          type: 'string',
          alias: 'p'
        })
        .example('$0 brain new my-brain', 'Create a new brain in the current project directory')
        .example('$0 brain new my-brain -p "Create a brain for data processing"', 'Create a brain using a prompt');
    }, (argv) => brainCommand.new(argv));
  }

  return yargs.demandCommand(1, 'You need to specify a brain command (new, list, history, show, rerun, run, watch).');
})

// --- Prompt Management Commands ---
cli = cli.command('prompt', 'Prompts are a one-shot call to an LLM with a typed return with no human in the loop (see agents for that) that you can use in your workflows.\n', (yargsPrompt) => {
  yargsPrompt
    .command('list', 'List all prompts in the active project\n', () => {}, (argv) => promptCommand.list(argv))
    .command('show <prompt-name>', 'Show prompt details including usage statistics\n', (yargsShow) => {
      return yargsShow
        .positional('prompt-name', {
          describe: 'Name of the prompt',
          type: 'string',
          demandOption: true
        })
        .example('$0 prompt show my-prompt', 'Show usage statistics for my-prompt');
    }, (argv) => promptCommand.show(argv))

  // Command available ONLY in Local Dev Mode
  if (isLocalDevMode) {
    yargsPrompt.command('new <prompt-name>', 'Create a new prompt in the current project', (yargsNew) => {
      return yargsNew
        .positional('prompt-name', {
          describe: 'Name of the new prompt',
          type: 'string',
          demandOption: true
        })
        .example('$0 prompt new my-prompt', 'Create a new prompt file in the current project directory');
    }, (argv) => promptCommand.new(argv));
  }

  // Ensure at least one prompt subcommand is given
  return yargsPrompt.demandCommand(1, 'You need to specify a prompt command');
})

// --- Resource Management Commands ---
cli = cli.command('resource', 'Resources are any data that can be used in your workflows, agents, and prompts. They can be text or binaries.\n', (yargsResource) => {
  return yargsResource
    .command('list', 'List all resources in the active project\n', () => {}, handleResourceList)
    .demandCommand(1, 'You need to specify a resource command');
})

// --- Execution Commands ---
cli = cli.command('run <name-or-path>', 'Run a brain\n', (yargsRun) => {
  return yargsRun
    .positional('name-or-path', {
      describe: 'Name of the brain to run',
      type: 'string',
      demandOption: true
    })
    .option('starts-at', {
      describe: 'Start brain from specific step',
      type: 'number',
    })
    .alias('starts-at', 's')
    .option('stops-after', {
      describe: 'Stop brain after specific step',
      type: 'number',
    })
    .alias('stops-after', 'e')
    .option('verbose', {
      describe: 'Show verbose output',
      type: 'boolean',
    })
    .example('$0 run my-brain', 'Run a brain by name')
    .example('$0 run my-brain --starts-at=3 --verbose', 'Run brain starting at step 3')
    .example('$0 run my-brain -s 3 -e 5', 'Run brain steps 3 through 5');
}, (argv) => runCommand.handle(argv));

// --- Global List Command ---
cli = cli.command(
  'list',
  'List entities (brains, resources, etc.) in the current project',
  (yargsList) => {
    return yargsList
      .option('type', {
        describe: 'Filter by entity type (can be specified multiple times)',
        choices: ['brain', 'resource', 'prompt', 'all'],
        default: 'all',
        array: true
      })
      .example('$0 list', 'List all brains, resources, and prompts in the current project')
      .example('$0 list --type brain', 'List brains')
      .example('$0 list --type resource', 'List resources')
      .example('$0 list --type prompt', 'List prompts');
  }, handleGlobalList);

cli = cli.epilogue('For more information, visit https://positronic.sh');

// Parse the arguments
cli.parse();

function handleGlobalList(argv: any) {
  const context = isLocalDevMode ? `local project at ${projectRootPath}` : 'selected remote project';
  const typesToList = argv.type.includes('all')
    ? ['brain', 'resource', 'prompt']
    : argv.type;

  console.log(`Listing entities of types: ${typesToList.join(', ')} in ${context}`);
  // TODO: Implement actual listing logic, querying either local file system or remote API based on typesToList
}

// Add handlers for the resource commands
function handleResourceList() {
  console.log('Listing all resources');
}