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
import { ResourcesCommand } from './commands/resources.js';
import { CloudflareDevServer } from '@positronic/cloudflare';
import type { PositronicDevServer } from '@positronic/spec';

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
const cloudflareDevServerTemplateDir = path.join(
  templatesBaseDir,
  'cloudflare-dev-server'
);
const brainTemplateDir = path.join(templatesBaseDir, 'brain');

// Instantiate command classes, passing the determined mode and path
const projectCommand = new ProjectCommand(isLocalDevMode);

const serverCommand = new ServerCommand();

const brainCommand = new BrainCommand();
const promptCommand = new PromptCommand(isLocalDevMode, projectRootPath);
const resourcesCommand = new ResourcesCommand(isLocalDevMode, projectRootPath);

// Main CLI definition
let cli = yargs(hideBin(process.argv))
  .scriptName('positronic')
  .usage('Usage: $0 <command> [options]')
  .version()
  .alias('v', 'version')
  .help('h')
  .alias('h', 'help')
  .wrap(null)
  .strictCommands();

// --- Project Management Commands (Global Mode Only) ---
cli = cli.command(
  'project',
  'Manage your Positronic projects\n',
  (yargsProject) => {
    if (!isLocalDevMode) {
      yargsProject.command(
        'new <name>',
        'Create a new Positronic project directory',
        (yargsNew) => {
          return yargsNew.positional('name', {
            describe: 'Name of the new project directory to create',
            type: 'string',
            demandOption: true,
          });
        },
        (argv) => projectCommand.create(argv as any)
      );
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
            .example(
              '$0 project add my-project --url https://api.my-project.positronic.sh',
              'Add a project configuration'
            );
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
              type: 'string',
            })
            .example(
              '$0 project select my-project',
              'Switch the active project'
            )
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
      .demandCommand(
        1,
        'You need to specify a project command (add, select, list, show) in Local Dev Mode.'
      );

    return yargsProject;
  }
);

// --- Add the 'new' command alias (Global Mode Only) ---
if (!isLocalDevMode) {
  cli = cli.command(
    'new <name>',
    'Alias for `project new`. Create a new Positronic project directory.\n',
    (yargsNewAlias) => {
      return yargsNewAlias.positional('name', {
        describe: 'Name of the new project directory to create',
        type: 'string',
        demandOption: true,
      });
    },
    (argv) => projectCommand.create(argv as any)
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
        })
        .option('port', {
          describe: 'Port number for the server to listen on',
          type: 'number',
          alias: 'p',
        });
    },
    (argv) => serverCommand.handle(argv, projectRootPath)
  );
}

// --- List Brains Command ---
cli = cli.command(
  'list',
  'List all brains in the active project\n',
  () => {},
  (argv) => brainCommand.list(argv)
);

// --- Brain History Command ---
cli = cli.command(
  'history <name>',
  'List recent runs of a specific brain\n',
  (yargsHistory) => {
    return yargsHistory
      .positional('name', {
        describe: 'Name of the brain',
        type: 'string',
        demandOption: true,
      })
      .option('limit', {
        describe: 'Maximum number of runs to show',
        type: 'number',
        default: 10,
      })
      .example('$0 history my-brain', 'List recent runs for my-brain')
      .example('$0 history my-brain --limit=20', 'List more recent runs');
  },
  (argv) => brainCommand.history(argv as any)
);

// --- Show Brain Command ---
cli = cli.command(
  'show <name>',
  'List all steps and other details for the brain\n',
  (yargsShow) => {
    return yargsShow.positional('name', {
      describe: 'Name of the brain',
      type: 'string',
      demandOption: true,
    });
  },
  (argv) => brainCommand.show(argv as any)
);

// --- Rerun Brain Command ---
cli = cli.command(
  'rerun <name> [run-id]',
  'Rerun an existing brain run\n',
  (yargsRerun) => {
    return yargsRerun
      .positional('name', {
        describe: 'Name of the brain',
        type: 'string',
        demandOption: true,
      })
      .positional('run-id', {
        describe:
          'ID of the brain run to rerun (defaults to the most recent run)',
        type: 'string',
      })
      .option('starts-at', {
        describe: 'Step number to start execution from',
        type: 'number',
      })
      .alias('starts-at', 's')
      .option('stops-after', {
        describe: 'Step number to stop execution after',
        type: 'number',
      })
      .alias('stops-after', 'e')
      .example(
        '$0 rerun my-brain',
        'Rerun the most recent execution of my-brain'
      )
      .example('$0 rerun my-brain abc123', 'Rerun a specific brain run')
      .example('$0 rerun my-brain --starts-at=3', 'Rerun from step 3')
      .example(
        '$0 rerun my-brain --stops-after=5',
        'Rerun and stop after step 5'
      )
      .example(
        '$0 rerun my-brain --starts-at=3 --stops-after=5',
        'Rerun steps 3 through 5'
      );
  },
  (argv) => brainCommand.rerun(argv as any)
);

// --- Run Brain Command ---
cli = cli.command(
  'run <name>',
  'Run a brain and optionally watch its execution\n',
  (yargsRun) => {
    return yargsRun
      .positional('name', {
        describe: 'Name of the brain',
        type: 'string',
        demandOption: true,
      })
      .option('watch', {
        describe: 'Watch the brain run immediately after starting',
        type: 'boolean',
        alias: 'w',
        default: false,
      })
      .example('$0 run my-brain', 'Run a brain by name')
      .example(
        '$0 run my-brain --watch',
        'Run a brain and watch its execution'
      );
  },
  (argv) => brainCommand.run(argv as any)
);

// --- Watch Brain Run Command ---
cli = cli.command(
  'watch [name]',
  'Watch a brain run: latest by name (default) or specific by ID\n',
  (yargsWatch) => {
    return yargsWatch
      .positional('name', {
        describe: 'Name of the brain to watch (watches the most recent run)',
        type: 'string',
      })
      .option('run-id', {
        describe: 'ID of the specific brain run to watch',
        type: 'string',
        alias: 'id',
      })
      .conflicts('name', 'run-id')
      .check((argv) => {
        if (!argv.name && !argv.runId) {
          throw new Error(
            'You must provide either a brain name or a --run-id.'
          );
        }
        return true;
      })
      .example(
        '$0 watch my-brain',
        "Watch the latest run of the brain named 'my-brain'"
      )
      .example(
        '$0 watch --run-id abc123def',
        'Watch a specific brain run by its ID'
      );
  },
  (argv) => brainCommand.watch(argv as any)
);

// --- New Brain Command (Local Dev Mode Only) ---
if (isLocalDevMode) {
  cli = cli.command(
    'new-brain <name>',
    'Create a new brain in the current project',
    (yargsNew) => {
      return yargsNew
        .positional('name', {
          describe: 'Name of the new brain',
          type: 'string',
          demandOption: true,
        })
        .option('prompt', {
          describe: 'Prompt to use for generating the brain',
          type: 'string',
          alias: 'p',
        })
        .example(
          '$0 new-brain my-brain',
          'Create a new brain in the current project directory'
        )
        .example(
          '$0 new-brain my-brain -p "Create a brain for data processing"',
          'Create a brain using a prompt'
        );
    },
    (argv) => brainCommand.new(argv as any)
  );
}

// --- Prompt Management Commands ---
cli = cli.command(
  'prompt',
  'Prompts are a one-shot call to an LLM with a typed return with no human in the loop (see agents for that) that you can use in your workflows.\n',
  (yargsPrompt) => {
    yargsPrompt
      .command(
        'list',
        'List all prompts in the active project\n',
        () => {},
        (argv) => promptCommand.list(argv)
      )
      .command(
        'show <prompt-name>',
        'Show prompt details including usage statistics\n',
        (yargsShow) => {
          return yargsShow
            .positional('prompt-name', {
              describe: 'Name of the prompt',
              type: 'string',
              demandOption: true,
            })
            .example(
              '$0 prompt show my-prompt',
              'Show usage statistics for my-prompt'
            );
        },
        (argv) => promptCommand.show(argv)
      );

    // Command available ONLY in Local Dev Mode
    if (isLocalDevMode) {
      yargsPrompt.command(
        'new <prompt-name>',
        'Create a new prompt in the current project',
        (yargsNew) => {
          return yargsNew
            .positional('prompt-name', {
              describe: 'Name of the new prompt',
              type: 'string',
              demandOption: true,
            })
            .example(
              '$0 prompt new my-prompt',
              'Create a new prompt file in the current project directory'
            );
        },
        (argv) => promptCommand.new(argv)
      );
    }

    // Ensure at least one prompt subcommand is given
    return yargsPrompt.demandCommand(1, 'You need to specify a prompt command');
  }
);

// --- Resource Management Commands ---
cli = cli.command(
  'resources',
  'Resources are any data that can be used in your workflows, agents, and prompts. They can be text or binaries.\n',
  (yargsResource) => {
    yargsResource.command(
      'list',
      'List all resources in the active project\n',
      (yargsListCmd) => {
        return yargsListCmd.example(
          '$0 resources list',
          'List all resources in the active project'
        );
      },
      () => resourcesCommand.list()
    );

    // Command available ONLY in Local Dev Mode
    if (isLocalDevMode) {
      yargsResource.command(
        'sync',
        'Sync local resources folder with the server so they are available to brains when they run\n',
        (yargsSyncCmd) => {
          return yargsSyncCmd.example(
            '$0 resources sync',
            'Upload new or modified resources to the server'
          );
        },
        () => resourcesCommand.sync()
      );

      yargsResource.command(
        'types',
        'Generate TypeScript type definitions for resources\n',
        (yargsTypesCmd) => {
          return yargsTypesCmd.example(
            '$0 resources types',
            'Generate a resources.d.ts file with type definitions for all resources'
          );
        },
        () => resourcesCommand.types()
      );

      yargsResource.command(
        'clear',
        'Delete ALL resources from the server (development only)\n',
        (yargsClearCmd) => {
          return yargsClearCmd.example(
            '$0 resources clear',
            'Delete all resources from the server'
          );
        },
        () => resourcesCommand.clear()
      );
    }

    // Delete command available in both dev and production modes
    yargsResource.command(
      'delete <path>',
      'Delete a specific resource from the server\n',
      (yargsDeleteCmd) => {
        return yargsDeleteCmd
          .positional('path', {
            describe:
              'Path of the resource to delete (relative to resources directory)',
            type: 'string',
            demandOption: true,
          })
          .example(
            '$0 resources delete myfile.txt',
            'Delete a resource at the root of resources directory'
          )
          .example(
            '$0 resources delete subfolder/data.json',
            'Delete a resource in a subdirectory'
          );
      },
      (argv) => resourcesCommand.delete(argv.path as string)
    );

    return yargsResource.demandCommand(
      1,
      'You need to specify a resources command'
    );
  }
);

cli = cli.epilogue('For more information, visit https://positronic.sh');

// Parse the arguments
cli.parse();
