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

// --- Brain Commands ---
cli = cli.command('brain', 'Manage your brains\n', (yargsBrain) => {
  // --- New Brain Command (Local Dev Mode Only) ---
  if (isLocalDevMode) {
    yargsBrain.command(
      'new <name>',
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
            '$0 brain new my-brain',
            'Create a new brain in the current project directory'
          )
          .example(
            '$0 brain new my-brain -p "Create a brain for data processing"',
            'Create a brain using a prompt'
          );
      },
      (argv) => brainCommand.new(argv as any)
    );
  }
  return yargsBrain;
});

// --- Add the 'new' command alias (Local Dev Mode only) ---
if (isLocalDevMode) {
  cli = cli.command(
    'new <name>',
    'Alias for `brain new`. Create a new brain in the current project.\n',
    (yargsNewAlias) => {
      return yargsNewAlias
        .positional('name', {
          describe: 'Name of the new brain to create',
          type: 'string',
          demandOption: true,
        })
        .option('prompt', {
          describe: 'Prompt to use for generating the brain',
          type: 'string',
          alias: 'p',
        });
    },
    (argv) => brainCommand.new(argv as any)
  );
}

// --- Prompt Management Commands ---
cli = cli.command(
  'prompt',
  'Prompts are a one-shot call to an LLM with a typed return with no human in the loop (see brains for that) that you can use in your brains.\n',
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
  'Resources are any data that can be used in your brains, agents, and prompts. They can be text or binaries.\n',
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

    // Upload/delete command available in both dev and production modes
    yargsResource.command(
      'upload <file>',
      'Upload a file as a resource, or delete with -d flag\n',
      (yargsUploadCmd) => {
        return yargsUploadCmd
          .positional('file', {
            describe: 'File path to upload, or resource key when using -d flag',
            type: 'string',
            demandOption: true,
          })
          .option('key', {
            describe: 'Custom key/path for the resource (defaults to filename)',
            type: 'string',
            alias: 'k',
          })
          .option('delete', {
            describe: 'Delete the resource instead of uploading',
            type: 'boolean',
            alias: 'd',
            default: false,
          })
          .example('$0 resources upload video.mp4', 'Upload a video file')
          .example(
            '$0 resources upload /path/to/large-file.zip --key archive/backup.zip',
            'Upload with custom resource key'
          )
          .example(
            '$0 resources upload -d video.mp4',
            'Delete the resource with key "video.mp4"'
          )
          .example(
            '$0 resources upload -d archive/backup.zip',
            'Delete a resource with a nested key'
          );
      },
      (argv) => {
        if (argv.delete) {
          return resourcesCommand.delete(argv.file as string);
        }
        return resourcesCommand.upload(
          argv.file as string,
          argv.key as string | undefined
        );
      }
    );

    return yargsResource.demandCommand(
      1,
      'You need to specify a resources command'
    );
  }
);

// --- Schedule Management Commands ---
cli = cli.command(
  'schedule',
  'Schedule brain runs to execute automatically on a cron schedule\n',
  (yargsSchedule) => {
    yargsSchedule
      .command(
        'create <brain-name> <cron-expression>',
        'Create a new schedule for a brain\n',
        (yargsCreate) => {
          return yargsCreate
            .positional('brain-name', {
              describe: 'Name of the brain to schedule',
              type: 'string',
              demandOption: true,
            })
            .positional('cron-expression', {
              describe:
                'Cron expression for the schedule (e.g., "0 3 * * *" for daily at 3am)',
              type: 'string',
              demandOption: true,
            })
            .example(
              '$0 schedule create my-brain "0 3 * * *"',
              'Run my-brain daily at 3am'
            )
            .example(
              '$0 schedule create data-sync "*/30 * * * *"',
              'Run data-sync every 30 minutes'
            )
            .example(
              '$0 schedule create weekly-report "0 9 * * 1"',
              'Run weekly-report every Monday at 9am'
            );
        },
        (argv) => {
          console.log(
            'TODO: Create schedule',
            argv.brainName,
            argv.cronExpression
          );
        }
      )
      .command(
        'list',
        'List all scheduled brain runs\n',
        (yargsList) => {
          return yargsList
            .option('brain', {
              describe: 'Filter schedules by brain name',
              type: 'string',
              alias: 'b',
            })
            .example('$0 schedule list', 'List all schedules')
            .example(
              '$0 schedule list --brain my-brain',
              'List schedules for a specific brain'
            );
        },
        (argv) => {
          console.log('TODO: List schedules', argv.brain);
        }
      )
      .command(
        'delete <schedule-id>',
        'Delete a schedule\n',
        (yargsDelete) => {
          return yargsDelete
            .positional('schedule-id', {
              describe: 'ID of the schedule to delete',
              type: 'string',
              demandOption: true,
            })
            .option('force', {
              describe: 'Skip confirmation prompt',
              type: 'boolean',
              alias: 'f',
              default: false,
            })
            .example(
              '$0 schedule delete abc123',
              'Delete schedule with ID abc123'
            )
            .example(
              '$0 schedule delete abc123 --force',
              'Delete without confirmation'
            );
        },
        (argv) => {
          console.log('TODO: Delete schedule', argv.scheduleId, argv.force);
        }
      )
      .command(
        'runs',
        'List scheduled run history\n',
        (yargsRuns) => {
          return yargsRuns
            .option('schedule-id', {
              describe: 'Filter runs by schedule ID',
              type: 'string',
              alias: 's',
            })
            .option('limit', {
              describe: 'Maximum number of runs to show',
              type: 'number',
              alias: 'l',
              default: 20,
            })
            .option('status', {
              describe: 'Filter by run status',
              type: 'string',
              choices: ['triggered', 'failed', 'complete'],
            })
            .example('$0 schedule runs', 'List recent scheduled runs')
            .example(
              '$0 schedule runs --schedule-id abc123',
              'List runs for a specific schedule'
            )
            .example(
              '$0 schedule runs --status failed --limit 50',
              'List last 50 failed scheduled runs'
            );
        },
        (argv) => {
          console.log(
            'TODO: List scheduled runs',
            argv.scheduleId,
            argv.limit,
            argv.status
          );
        }
      )
      .demandCommand(
        1,
        'You need to specify a schedule command (create, list, show, delete, runs)'
      );

    return yargsSchedule;
  }
);

cli = cli.epilogue('For more information, visit https://positronic.sh');

// Parse the arguments
cli.parse();
