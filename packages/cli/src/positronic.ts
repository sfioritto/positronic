#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ProjectCommand } from './commands/project.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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

// --- List Brains Command ---
cli = cli.command('list', 'List all brains in the active project\n', () => {}, (argv) => brainCommand.list(argv));

// --- Brain History Command ---
cli = cli.command('history <brain-name>', 'List recent runs of a specific brain\n', (yargsHistory) => {
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
      .example('$0 history my-brain', 'List recent runs for my-brain')
      .example('$0 history my-brain --limit=20', 'List more recent runs');
  }, (argv) => brainCommand.history(argv));

// --- Show Brain Command ---
cli = cli.command('show <brain-name>', 'List all steps and other details for the brain\n', (yargsShow) => {
    return yargsShow
      .positional('brain-name', {
        describe: 'Name of the brain',
        type: 'string',
        demandOption: true
      });
  }, (argv) => brainCommand.show(argv));

// --- Rerun Brain Command ---
cli = cli.command('rerun <brain-name> [brain-run-id]', 'Rerun an existing brain run\n', (yargsRerun) => {
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
      .example('$0 rerun my-brain', 'Rerun the most recent execution of my-brain')
      .example('$0 rerun my-brain abc123', 'Rerun a specific brain run')
      .example('$0 rerun my-brain --starts-at=3', 'Rerun from step 3')
      .example('$0 rerun my-brain --stops-after=5', 'Rerun and stop after step 5')
      .example('$0 rerun my-brain --starts-at=3 --stops-after=5', 'Rerun steps 3 through 5')
      .example('$0 rerun my-brain --verbose', 'Rerun with verbose output');
  }, (argv) => brainCommand.rerun(argv));

// --- Run Brain Command ---
cli = cli.command('run <brain-name>', 'Run a brain\n', (yargsRun) => {
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
      .example('$0 run my-brain', 'Run a brain by name')
      .example('$0 run my-brain --verbose', 'Run a brain with verbose output');
  }, (argv) => brainCommand.run(argv));

// --- Watch Brain Run Command ---
cli = cli.command('watch <brain-name>', 'Watch a specific brain run for live updates\n', (yargsWatch) => {
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
      .example('$0 watch my-brain --run-id abc123', 'Watch the brain run with ID abc123');
  }, (argv) => brainCommand.watch(argv));

// --- New Brain Command (Local Dev Mode Only) ---
if (isLocalDevMode) {
  cli = cli.command('new-brain <brain-name>', 'Create a new brain in the current project', (yargsNew) => { // Renamed to avoid conflict with project new alias
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
      .example('$0 new-brain my-brain', 'Create a new brain in the current project directory')
      .example('$0 new-brain my-brain -p "Create a brain for data processing"', 'Create a brain using a prompt');
  }, (argv) => brainCommand.new(argv));
}

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

cli = cli.epilogue('For more information, visit https://positronic.sh');

// Parse the arguments
cli.parse();

// Add handlers for the resource commands
function handleResourceList() {
  console.log('Listing all resources');
}