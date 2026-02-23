import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import React from 'react';
import { ProjectCommand } from './commands/project.js';
import { ServerCommand } from './commands/server.js';
import { BrainCommand } from './commands/brain.js';
import { ResourcesCommand } from './commands/resources.js';
import { ScheduleCommand } from './commands/schedule.js';
import { SecretCommand } from './commands/secret.js';
import { PagesCommand } from './commands/pages.js';
import { UsersCommand } from './commands/users.js';
import { AuthCommand } from './commands/auth.js';
import type { PositronicDevServer } from '@positronic/spec';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export interface CliOptions {
  argv?: string[];
  server?: PositronicDevServer;
  exitProcess?: boolean;
  render: (element: React.ReactElement) => any;
  projectRootPath?: string;
}

// Helper function to parse key=value options
function parseKeyValueOptions(opts: string[] | undefined): Record<string, string> | undefined {
  if (!opts || opts.length === 0) return undefined;
  
  const parsed: Record<string, string> = {};
  for (const opt of opts) {
    const [key, ...valueParts] = opt.split('=');
    const value = valueParts.join('=');
    
    if (!key || !value) {
      throw new Error(`Invalid option format: "${opt}". Options must be in key=value format.`);
    }
    
    parsed[key] = value;
  }
  return parsed;
}

export function buildCli(options: CliOptions) {
  const {
    argv = hideBin(process.argv),
    server,
    exitProcess = false,
    render,
    projectRootPath,
  } = options;

  const isLocalDevMode = server !== undefined;

  // Get version from package.json
  let version = 'TEST'; // Default version for test environment where package.json path differs
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    version = packageJson.version;
  } catch (error) {
    // In test environment, the relative path to package.json is different
    // so we use 'TEST' as the version to avoid breaking tests
  }

  // Instantiate command classes, passing the determined mode and path
  const projectCommand = new ProjectCommand();
  const brainCommand = new BrainCommand();
  const scheduleCommand = new ScheduleCommand();
  const secretCommand = new SecretCommand();
  const pagesCommand = new PagesCommand();
  const usersCommand = new UsersCommand();

  // Main CLI definition
  let cli = yargs(argv)
    .scriptName('positronic')
    .usage('Usage: $0 <command> [options]')
    .version(version)
    .alias('v', 'version')
    .help('h')
    .alias('h', 'help')
    .wrap(null)
    .strictCommands()
    .exitProcess(exitProcess);

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
          (argv) => {
            const element = projectCommand.create(argv);
            render(element);
          }
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
          (argv) => {
            const element = projectCommand.add(argv);
            render(element);
          }
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
          (argv) => {
            const element = projectCommand.select(argv);
            render(element);
          }
        )
        .command(
          'list',
          'List all of your Positronic projects',
          () => {},
          () => {
            const element = projectCommand.list();
            render(element);
          }
        )
        .command(
          'show',
          'Display your currently selected project',
          () => {},
          () => {
            const element = projectCommand.show();
            render(element);
          }
        )
        .command(
          'rm <name>',
          'Remove a project from your list of projects',
          (yargsRm) => {
            return yargsRm
              .positional('name', {
                describe: 'Name of the project to remove',
                type: 'string',
                demandOption: true,
              })
              .example(
                '$0 project rm my-project',
                'Remove a project configuration'
              );
          },
          (argv) => {
            const element = projectCommand.remove(argv);
            render(element);
          }
        )
        .demandCommand(
          1,
          'You need to specify a project command (add, select, list, show, rm) in Local Dev Mode.'
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
      (argv) => {
        const element = projectCommand.create(argv);
        render(element);
      }
    );
  }

  // --- Add the Server Command ---
  // The server command should only be available in local dev mode;
  // Wrap its registration in the check
  if (isLocalDevMode) {
    const serverCommand = new ServerCommand(server);
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
          })
          .option('log-file', {
            describe: 'File to redirect server output to (for AI agents)',
            type: 'string',
            alias: 'l',
          })
          .option('d', {
            describe: 'Run server in detached/background mode',
            type: 'boolean',
            default: false,
          })
          .option('k', {
            describe: 'Kill the default background server',
            type: 'boolean',
            default: false,
          });
      },
      (argv) => serverCommand.handle(argv)
    );

    // Add deploy command (only in local dev mode)
    cli = cli.command(
      'deploy',
      'Deploy the project to production',
      () => {},
      async () => {
        try {
          // Deploy
          await server.deploy();
        } catch (error) {
          console.error(
            'Deployment failed:',
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    );
  }

  // --- List Brains Command ---
  cli = cli.command(
    'list',
    'List all brains in the active project\n',
    () => {},
    (argv) => {
      const element = brainCommand.list(argv);
      render(element);
    }
  );

  // --- Brain History Command ---
  cli = cli.command(
    'history <brain>',
    'List recent runs of a specific brain\n',
    (yargsHistory) => {
      return yargsHistory
        .positional('brain', {
          describe: 'Brain identifier (title, filename, or search term)',
          type: 'string',
          demandOption: true,
        })
        .option('limit', {
          describe: 'Maximum number of runs to show',
          type: 'number',
          default: 10,
        })
        .example('$0 history my-brain', 'List recent runs for my-brain')
        .example('$0 history "My Brain Title"', 'Search by title')
        .example('$0 history my-brain --limit=20', 'List more recent runs');
    },
    (argv) => {
      const element = brainCommand.history(argv);
      render(element);
    }
  );

  // --- Show Brain/Run Command ---
  cli = cli.command(
    'show [brain]',
    'Show information about a brain or a specific run\n',
    (yargsShow) => {
      return yargsShow
        .positional('brain', {
          describe: 'Brain identifier to show info for',
          type: 'string',
        })
        .option('run-id', {
          describe: 'ID of a specific brain run to show',
          type: 'string',
          alias: 'id',
        })
        .option('steps', {
          describe: 'Show the step structure of the brain',
          type: 'boolean',
          default: false,
        })
        .check((argv) => {
          if (!argv.brain && !argv.runId) {
            throw new Error('You must provide either a brain identifier or a --run-id.');
          }
          return true;
        })
        .example('$0 show my-brain', 'Show info about my-brain')
        .example('$0 show my-brain --steps', 'Show my-brain with step structure')
        .example('$0 show --run-id abc123', 'Show details for a specific run');
    },
    (argv) => {
      const element = brainCommand.show(argv as any);
      render(element);
    }
  );

  // --- Rerun Brain Command ---
  cli = cli.command(
    'rerun <brain> [run-id]',
    'Rerun an existing brain run\n',
    (yargsRerun) => {
      return yargsRerun
        .positional('brain', {
          describe: 'Brain identifier (title, filename, or search term)',
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
    (argv) => {
      const element = brainCommand.rerun(argv);
      render(element);
    }
  );

  // --- Run Brain Command ---
  cli = cli.command(
    ['run <brain>', 'r <brain>'],
    'Run a brain and optionally watch its execution\n',
    (yargsRun) => {
      return yargsRun
        .positional('brain', {
          describe: 'Brain identifier (title, filename, or search term)',
          type: 'string',
          demandOption: true,
        })
        .option('watch', {
          describe: 'Watch the brain run immediately after starting',
          type: 'boolean',
          alias: 'w',
          default: false,
        })
        .option('options', {
          describe: 'Options to pass to the brain (key=value format)',
          type: 'array',
          alias: 'o',
          string: true,
          coerce: parseKeyValueOptions
        })
        .example('$0 run my-brain', 'Run a brain by filename')
        .example('$0 run "Email Digest"', 'Run a brain by title')
        .example('$0 run email', 'Fuzzy search for brains matching "email"')
        .example(
          '$0 run my-brain --watch',
          'Run a brain and watch its execution'
        )
        .example(
          '$0 run my-brain -o channel=#general -o debug=true',
          'Run a brain with options'
        );
    },
    (argv) => {
      const element = brainCommand.run(argv);
      render(element);
    }
  );

  // --- Watch Brain Run Command ---
  cli = cli.command(
    'watch <identifier>',
    'Watch a brain run by brain name or run ID\n',
    (yargsWatch) => {
      return yargsWatch
        .positional('identifier', {
          describe: 'Brain name or run ID to watch',
          type: 'string',
          demandOption: true,
        })
        .option('events', {
          describe: 'Start in events view instead of progress view',
          type: 'boolean',
          alias: 'e',
          default: false,
        })
        .example(
          '$0 watch my-brain',
          "Watch the latest run of the brain named 'my-brain'"
        )
        .example(
          '$0 watch abc123def',
          'Watch a specific brain run by its ID'
        )
        .example(
          '$0 watch my-brain --events',
          'Watch with events log view'
        );
    },
    (argv) => {
      const element = brainCommand.watch(argv);
      render(element);
    }
  );

  // --- Top Command (view running brains) ---
  cli = cli.command(
    'top [brain]',
    'View live status of all running brains\n',
    (yargsTop) => {
      return yargsTop
        .positional('brain', {
          describe: 'Filter to brains matching this name',
          type: 'string',
        })
        .example('$0 top', 'View all running brains')
        .example('$0 top my-brain', 'View running brains matching "my-brain"');
    },
    (argv) => {
      const element = brainCommand.top(argv);
      render(element);
    }
  );

  // --- Brain Commands ---
  cli = cli.command('brain', 'Manage your brains\n', (yargsBrain) => {
    yargsBrain
      .command(
        'list',
        'List all brains in the active project\n',
        () => {},
        (argv) => {
          const element = brainCommand.list(argv);
          render(element);
        }
      )
      .command(
        'history <brain>',
        'List recent runs of a specific brain\n',
        (yargsHistory) => {
          return yargsHistory
            .positional('brain', {
              describe: 'Brain identifier (title, filename, or search term)',
              type: 'string',
              demandOption: true,
            })
            .option('limit', {
              describe: 'Maximum number of runs to show',
              type: 'number',
              default: 10,
            })
            .example('$0 brain history my-brain', 'List recent runs for my-brain')
            .example('$0 brain history my-brain --limit=20', 'List more recent runs');
        },
        (argv) => {
          const element = brainCommand.history(argv);
          render(element);
        }
      )
      .command(
        'show [brain]',
        'Show information about a brain or a specific run\n',
        (yargsShow) => {
          return yargsShow
            .positional('brain', {
              describe: 'Brain identifier to show info for',
              type: 'string',
            })
            .option('run-id', {
              describe: 'ID of a specific brain run to show',
              type: 'string',
              alias: 'id',
            })
            .option('steps', {
              describe: 'Show the step structure of the brain',
              type: 'boolean',
              default: false,
            })
            .check((argv) => {
              if (!argv.brain && !argv.runId) {
                throw new Error('You must provide either a brain identifier or a --run-id.');
              }
              return true;
            })
            .example('$0 brain show my-brain', 'Show info about my-brain')
            .example('$0 brain show my-brain --steps', 'Show my-brain with step structure')
            .example('$0 brain show --run-id abc123', 'Show details for a specific run');
        },
        (argv) => {
          const element = brainCommand.show(argv as any);
          render(element);
        }
      )
      .command(
        'rerun <brain> [run-id]',
        'Rerun an existing brain run\n',
        (yargsRerun) => {
          return yargsRerun
            .positional('brain', {
              describe: 'Brain identifier (title, filename, or search term)',
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
              '$0 brain rerun my-brain',
              'Rerun the most recent execution of my-brain'
            )
            .example('$0 brain rerun my-brain abc123', 'Rerun a specific brain run')
            .example('$0 brain rerun my-brain --starts-at=3', 'Rerun from step 3')
            .example(
              '$0 brain rerun my-brain --stops-after=5',
              'Rerun and stop after step 5'
            )
            .example(
              '$0 brain rerun my-brain --starts-at=3 --stops-after=5',
              'Rerun steps 3 through 5'
            );
        },
        (argv) => {
          const element = brainCommand.rerun(argv);
          render(element);
        }
      )
      .command(
        'run <brain>',
        'Run a brain and optionally watch its execution\n',
        (yargsRun) => {
          return yargsRun
            .positional('brain', {
              describe: 'Brain identifier (title, filename, or search term)',
              type: 'string',
              demandOption: true,
            })
            .option('watch', {
              describe: 'Watch the brain run immediately after starting',
              type: 'boolean',
              alias: 'w',
              default: false,
            })
            .option('options', {
              describe: 'Options to pass to the brain (key=value format)',
              type: 'array',
              alias: 'o',
              string: true,
              coerce: parseKeyValueOptions
            })
            .example('$0 brain run my-brain', 'Run a brain by filename')
            .example('$0 brain run "Email Digest"', 'Run a brain by title')
            .example('$0 brain run email', 'Fuzzy search for brains matching "email"')
            .example(
              '$0 brain run my-brain --watch',
              'Run a brain and watch its execution'
            )
            .example(
              '$0 brain run my-brain -o channel=#general -o debug=true',
              'Run a brain with options'
            );
        },
        (argv) => {
          const element = brainCommand.run(argv);
          render(element);
        }
      )
      .command(
        'watch <identifier>',
        'Watch a brain run by brain name or run ID\n',
        (yargsWatch) => {
          return yargsWatch
            .positional('identifier', {
              describe: 'Brain name or run ID to watch',
              type: 'string',
              demandOption: true,
            })
            .option('events', {
              describe: 'Start in events view instead of progress view',
              type: 'boolean',
              alias: 'e',
              default: false,
            })
            .example(
              '$0 brain watch my-brain',
              "Watch the latest run of the brain named 'my-brain'"
            )
            .example(
              '$0 brain watch abc123def',
              'Watch a specific brain run by its ID'
            )
            .example(
              '$0 brain watch my-brain --events',
              'Watch with events log view'
            );
        },
        (argv) => {
          const element = brainCommand.watch(argv);
          render(element);
        }
      )
      .command(
        'kill <run-id>',
        'Kill a running brain\n',
        (yargsKill) => {
          return yargsKill
            .positional('run-id', {
              describe: 'ID of the brain run to kill',
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
              '$0 brain kill abc123def',
              'Kill a running brain by its run ID'
            )
            .example(
              '$0 brain kill abc123def --force',
              'Kill a brain without confirmation'
            );
        },
        (argv) => {
          const element = brainCommand.kill(argv);
          render(element);
        }
      )
      .command(
        'top [brain]',
        'View live status of all running brains\n',
        (yargsTop) => {
          return yargsTop
            .positional('brain', {
              describe: 'Filter to brains matching this name',
              type: 'string',
            })
            .example('$0 brain top', 'View all running brains')
            .example('$0 brain top my-brain', 'View running brains matching "my-brain"');
        },
        (argv) => {
          const element = brainCommand.top(argv);
          render(element);
        }
      )
      .demandCommand(
        1,
        'You need to specify a brain command (list, history, show, rerun, run, watch, kill, top).'
      );

    return yargsBrain;
  });


  // --- Resource Management Commands ---
  cli = cli.command(
    'resources',
    'Resources are any data that can be used in your brains, agents, and prompts. They can be text or binaries.\n',
    (yargsResource) => {
      const resourcesCommand = new ResourcesCommand(server);

      yargsResource.command(
        'list',
        'List all resources in the active project\n',
        (yargsListCmd) => {
          return yargsListCmd.example(
            '$0 resources list',
            'List all resources in the active project'
          );
        },
        () => {
          const element = resourcesCommand.list();
          render(element);
        }
      );

      // Command available ONLY in Local Dev Mode

      yargsResource.command(
        'sync',
        'Sync local resources folder with the server so they are available to brains when they run\n',
        (yargsSyncCmd) => {
          return yargsSyncCmd.example(
            '$0 resources sync',
            'Upload new or modified resources to the server'
          );
        },
        () => {
          const element = resourcesCommand.sync();
          render(element);
        }
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
        () => {
          const element = resourcesCommand.types();
          render(element);
        }
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
        async () => {
          const element = await resourcesCommand.clear();
          if (element) {
            render(element);
          }
        }
      );

      // Upload/delete command available in both dev and production modes
      yargsResource.command(
        'upload <file>',
        'Upload a file as a resource, or delete with -d flag\n',
        (yargsUploadCmd) => {
          return yargsUploadCmd
            .positional('file', {
              describe:
                'File path to upload, or resource key when using -d flag',
              type: 'string',
              demandOption: true,
            })
            .option('key', {
              describe:
                'Custom key/path for the resource (defaults to filename)',
              type: 'string',
              alias: 'k',
            })
            .option('delete', {
              describe: 'Delete the resource instead of uploading',
              type: 'boolean',
              alias: 'd',
              default: false,
            })
            .option('force', {
              describe: 'Skip confirmation prompts (use with --delete)',
              type: 'boolean',
              alias: 'f',
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
            )
            .example(
              '$0 resources upload -d -f video.mp4',
              'Delete a resource without confirmation'
            );
        },
        (argv) => {
          if (argv.delete) {
            const element = resourcesCommand.delete(
              argv.file as string,
              argv.force as boolean
            );
            render(element);
          } else {
            const element = resourcesCommand.upload(
              argv.file as string,
              argv.key as string | undefined
            );
            render(element);
          }
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
      // Add top-level options for list and delete
      yargsSchedule
        .option('list', {
          describe: 'List all scheduled brain runs',
          type: 'boolean',
          alias: 'l',
        })
        .option('delete', {
          describe: 'Delete a schedule by ID',
          type: 'string',
          alias: 'd',
        })
        .option('brain', {
          describe: 'Filter schedules by brain name (used with -l)',
          type: 'string',
          alias: 'b',
        })
        .option('force', {
          describe: 'Skip confirmation prompt (used with -d)',
          type: 'boolean',
          alias: 'f',
          default: false,
        })
        .example('$0 schedule -l', 'List all schedules')
        .example(
          '$0 schedule -l --brain my-brain',
          'List schedules for a specific brain'
        )
        .example('$0 schedule -d abc123', 'Delete schedule with ID abc123')
        .example('$0 schedule -d abc123 --force', 'Delete without confirmation')
        .check((argv) => {
          // Count how many operations are specified
          const operations = [
            argv.list,
            argv.delete,
            argv._.includes('create') || argv._.includes('c'),
            argv._.includes('runs'),
          ].filter(Boolean).length;

          if (operations === 0) {
            throw new Error(
              'You must specify an operation: create, -l (list), -d (delete), or runs'
            );
          }
          if (operations > 1) {
            throw new Error('You can only specify one operation at a time');
          }
          return true;
        });

      // Handle top-level list/delete options
      yargsSchedule.middleware(async (argv) => {
        // If -l flag is used, call list command
        if (argv.list) {
          const element = scheduleCommand.list({ brain: argv.brain } as any);
          const result = render(element);
          // Wait for the component to finish rendering (in production, Ink's render returns waitUntilExit)
          if (result && typeof result.waitUntilExit === 'function') {
            await result.waitUntilExit();
          }
          // Exit after completion to prevent further command processing
          process.exit(0);
        }
        // If -d flag is used, call delete command
        if (argv.delete) {
          const element = scheduleCommand.delete({
            scheduleId: argv.delete as string,
            force: argv.force,
          } as any);
          const result = render(element);
          // Wait for the component to finish rendering (in production, Ink's render returns waitUntilExit)
          if (result && typeof result.waitUntilExit === 'function') {
            await result.waitUntilExit();
          }
          // Exit after completion to prevent further command processing
          process.exit(0);
        }
      }, true);

      yargsSchedule
        .command(
          [
            'create <brain> <cron-expression>',
            'c <brain> <cron-expression>',
          ],
          'Create a new schedule for a brain\n',
          (yargsCreate) => {
            return yargsCreate
              .positional('brain', {
                describe: 'Brain identifier (title, filename, or search term)',
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
                '$0 schedule c my-brain "0 3 * * *"',
                'Run my-brain daily at 3am (shorthand)'
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
            const element = scheduleCommand.create(argv);
            render(element);
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
                alias: 'n',
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
            const element = scheduleCommand.runs(argv as any);
            render(element);
          }
        );

      return yargsSchedule;
    }
  );

  // --- Pages Management Commands ---
  cli = cli.command(
    'pages',
    'Manage pages created by brains\n',
    (yargsPages) => {
      yargsPages
        .command(
          'list',
          'List all pages\n',
          {},
          (argv) => {
            const element = pagesCommand.list(argv);
            render(element);
          }
        )
        .command(
          'delete <slug>',
          'Delete a page by slug\n',
          (yargsDelete) => {
            return yargsDelete
              .positional('slug', {
                describe: 'Slug of the page to delete',
                type: 'string',
                demandOption: true,
              })
              .option('force', {
                describe: 'Skip confirmation prompt',
                type: 'boolean',
                alias: 'f',
                default: false,
              })
              .example('$0 pages delete my-page', 'Delete a page by slug')
              .example(
                '$0 pages delete my-page --force',
                'Delete without confirmation'
              );
          },
          (argv) => {
            const element = pagesCommand.delete(argv);
            render(element);
          }
        )
        .demandCommand(1, 'You need to specify a subcommand');

      return yargsPages;
    }
  );

  // --- Secret Management Commands ---
  cli = cli.command(
    'secret',
    'Manage secrets for your brains\n',
    (yargsSecret) => {
      yargsSecret
        .command(
          'list',
          'List all secrets\n',
          {},
          () => {
            const element = secretCommand.list();
            render(element);
          }
        )
        .command(
          'create <name>',
          'Create a new secret\n',
          (yargsCreate) => {
            return yargsCreate
              .positional('name', {
                describe: 'Name of the secret (e.g., ANTHROPIC_API_KEY)',
                type: 'string',
                demandOption: true,
              })
              .option('value', {
                describe: 'Secret value (omit for secure input)',
                type: 'string',
              })
              .example(
                '$0 secret create ANTHROPIC_API_KEY',
                'Create a secret with secure input'
              )
              .example(
                '$0 secret create DATABASE_URL --value "postgres://..."',
                'Create a secret with direct value (not recommended)'
              );
          },
          (argv) => {
            const element = secretCommand.create(argv);
            render(element);
          }
        )
        .command(
          'delete <name>',
          'Delete a secret\n',
          (yargsDelete) => {
            return yargsDelete
              .positional('name', {
                describe: 'Name of the secret to delete',
                type: 'string',
                demandOption: true,
              })
              .example(
                '$0 secret delete ANTHROPIC_API_KEY',
                'Delete a secret'
              );
          },
          (argv) => {
            const element = secretCommand.delete(argv);
            render(element);
          }
        )
        .command(
          'bulk [file]',
          'Bulk upload secrets from a .env file\n',
          (yargsBulk) => {
            return yargsBulk
              .positional('file', {
                describe: 'Path to the .env file (defaults to .env in project root)',
                type: 'string',
              })
              .example(
                '$0 secret bulk',
                'Upload secrets from .env file in project root'
              )
              .example(
                '$0 secret bulk .env.production',
                'Upload secrets from a specific .env file'
              );
          },
          (argv) => {
            const element = secretCommand.bulk(argv);
            render(element);
          }
        )
        .demandCommand(1, 'You need to specify a subcommand');

      return yargsSecret;
    }
  );

  // --- User Management Commands ---
  cli = cli.command(
    'users',
    'Manage users and SSH keys for authentication\n',
    (yargsUsers) => {
      yargsUsers
        .command(
          'list',
          'List all users\n',
          {},
          () => {
            const element = usersCommand.list();
            render(element);
          }
        )
        .command(
          'create <name>',
          'Create a new user\n',
          (yargsCreate) => {
            return yargsCreate
              .positional('name', {
                describe: 'Name of the user',
                type: 'string',
                demandOption: true,
              })
              .example('$0 users create admin', 'Create a user named admin');
          },
          (argv) => {
            const element = usersCommand.create(argv);
            render(element);
          }
        )
        .command(
          'delete <id>',
          'Delete a user\n',
          (yargsDelete) => {
            return yargsDelete
              .positional('id', {
                describe: 'ID of the user to delete',
                type: 'string',
                demandOption: true,
              })
              .option('force', {
                describe: 'Skip confirmation prompt',
                type: 'boolean',
                alias: 'f',
                default: false,
              })
              .example('$0 users delete abc123', 'Delete a user')
              .example(
                '$0 users delete abc123 --force',
                'Delete without confirmation'
              );
          },
          (argv) => {
            const element = usersCommand.delete(argv as any);
            render(element);
          }
        )
        .command(
          'keys',
          'Manage SSH keys for users\n',
          (yargsKeys) => {
            return yargsKeys
              .command(
                'list <user-id>',
                'List keys for a user\n',
                (yargsKeysList) => {
                  return yargsKeysList
                    .positional('user-id', {
                      describe: 'User ID',
                      type: 'string',
                      demandOption: true,
                    })
                    .example('$0 users keys list abc123', 'List keys for a user');
                },
                (argv) => {
                  const element = usersCommand.keysList({ id: argv.userId as string } as any);
                  render(element);
                }
              )
              .command(
                'add <user-id> <pubkey-path>',
                'Add an SSH public key to a user\n',
                (yargsAdd) => {
                  return yargsAdd
                    .positional('user-id', {
                      describe: 'User ID',
                      type: 'string',
                      demandOption: true,
                    })
                    .positional('pubkey-path', {
                      describe: 'Path to the SSH public key file',
                      type: 'string',
                      demandOption: true,
                    })
                    .option('label', {
                      describe: 'Label for the key (e.g., "laptop", "desktop")',
                      type: 'string',
                      alias: 'l',
                    })
                    .example(
                      '$0 users keys add abc123 ~/.ssh/id_rsa.pub',
                      'Add RSA public key'
                    )
                    .example(
                      '$0 users keys add abc123 ~/.ssh/id_ed25519.pub --label laptop',
                      'Add key with label'
                    );
                },
                (argv) => {
                  const element = usersCommand.keysAdd({
                    id: argv.userId as string,
                    pubkeyPath: argv.pubkeyPath as string,
                    label: argv.label as string | undefined,
                  } as any);
                  render(element);
                }
              )
              .command(
                'remove <user-id> <fingerprint>',
                'Remove a key from a user\n',
                (yargsRemove) => {
                  return yargsRemove
                    .positional('user-id', {
                      describe: 'User ID',
                      type: 'string',
                      demandOption: true,
                    })
                    .positional('fingerprint', {
                      describe: 'Fingerprint of the key to remove',
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
                      '$0 users keys remove abc123 SHA256:...',
                      'Remove a key'
                    );
                },
                (argv) => {
                  const element = usersCommand.keysRemove({
                    id: argv.userId as string,
                    fingerprint: argv.fingerprint as string,
                    force: argv.force as boolean,
                  } as any);
                  render(element);
                }
              )
              .demandCommand(1, 'You need to specify a keys command (list, add, remove)');
          }
        )
        .demandCommand(1, 'You need to specify a users command (list, create, delete, keys)');

      return yargsUsers;
    }
  );

  // --- Auth Commands (Available in both local and global mode) ---
  const authCommand = new AuthCommand(undefined, projectRootPath);
  {
    cli = cli.command(
      'auth',
      'Manage authentication configuration\n',
      (yargsAuth) => {
        yargsAuth
          .command(
            'status',
            'Show current auth configuration\n',
            () => {},
            () => {
              const element = authCommand.status();
              render(element);
            }
          )
          .command(
            'login',
            'Configure SSH key for authentication\n',
            (yargsLogin) => {
              return yargsLogin
                .option('path', {
                  describe: 'Path to SSH private key',
                  type: 'string',
                  alias: 'p',
                })
                .option('project', {
                  describe: 'Set key for current project instead of global',
                  type: 'boolean',
                  default: false,
                })
                .example('$0 auth login', 'Interactive key selection')
                .example(
                  '$0 auth login --path ~/.ssh/id_ed25519',
                  'Set key directly'
                )
                .example(
                  '$0 auth login --project',
                  'Set key for current project'
                );
            },
            (argv) => {
              const element = authCommand.login(argv as any);
              render(element);
            }
          )
          .command(
            'logout',
            'Clear SSH key configuration\n',
            (yargsLogout) => {
              return yargsLogout
                .option('project', {
                  describe: 'Clear key for current project only',
                  type: 'boolean',
                  default: false,
                })
                .example('$0 auth logout', 'Clear global key configuration')
                .example(
                  '$0 auth logout --project',
                  'Clear project-specific key'
                );
            },
            (argv) => {
              const element = authCommand.logout(argv as any);
              render(element);
            }
          )
          .command(
            'list',
            'List available SSH keys\n',
            () => {},
            () => {
              const element = authCommand.list();
              render(element);
            }
          )
          .command(
            'format-jwk-key',
            'Convert an SSH public key to JWK format for ROOT_PUBLIC_KEY\n',
            (yargsFormatJwkKey) => {
              return yargsFormatJwkKey
                .option('pubkey', {
                  describe: 'Path to SSH public key file',
                  type: 'string',
                  alias: 'p',
                })
                .example(
                  '$0 auth format-jwk-key',
                  'Interactive public key selection'
                )
                .example(
                  '$0 auth format-jwk-key --pubkey ~/.ssh/id_ed25519.pub',
                  'Convert specific key'
                );
            },
            (argv) => {
              const element = authCommand.formatJwkKey(argv as any);
              render(element);
            }
          )
          .command(
            '$0',
            false, // Hidden command - default action
            () => {},
            () => {
              // Default to status when just 'px auth' is run
              const element = authCommand.status();
              render(element);
            }
          );

        return yargsAuth;
      }
    );
  }

  cli = cli.epilogue('For more information, visit https://positronic.sh');

  return cli;
}
