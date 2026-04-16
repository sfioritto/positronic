import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import React from 'react';
import { ServerCommand } from './commands/server.js';
import type { PositronicDevServer } from '@positronic/spec';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Brain components
import { BrainList } from './components/brain-list.js';
import { BrainHistory } from './components/brain-history.js';
import { BrainShow } from './components/brain-show.js';
import { RunShow } from './components/run-show.js';
import { BrainRerun } from './components/brain-rerun.js';
import { BrainRun } from './components/brain-run.js';
import { BrainKill } from './components/brain-kill.js';
import { BrainResolver } from './components/brain-resolver.js';
import { WatchResolver } from './components/watch-resolver.js';
import { TopNavigator } from './components/top-navigator.js';

// Schedule components
import { ScheduleCreate } from './components/schedule-create.js';
import { ScheduleList } from './components/schedule-list.js';
import { ScheduleDelete } from './components/schedule-delete.js';
import { ScheduleRuns } from './components/schedule-runs.js';
import { ScheduleTimezone } from './components/schedule-timezone.js';

// Secrets components
import { SecretsList } from './components/secrets-list.js';
import { SecretsCreate } from './components/secrets-create.js';
import { SecretsDelete } from './components/secrets-delete.js';
import { SecretsBulk } from './components/secrets-bulk.js';

// Pages components
import { PagesList } from './components/pages-list.js';
import { PageDelete } from './components/page-delete.js';

// Users components
import { UsersList } from './components/users-list.js';
import { UsersCreate } from './components/users-create.js';
import { UsersDelete } from './components/users-delete.js';
import { UsersKeysList } from './components/users-keys-list.js';
import { UsersKeysAdd } from './components/users-keys-add.js';
import { UsersKeysRemove } from './components/users-keys-remove.js';

// Auth components
import { AuthLogin } from './components/auth-login.js';
import { AuthLogout } from './components/auth-logout.js';
import { Whoami } from './components/whoami.js';

// Project components
import { ProjectAdd } from './components/project-add.js';
import { ProjectList } from './components/project-list.js';
import { ProjectSelect } from './components/project-select.js';
import { ProjectShow } from './components/project-show.js';
import { ProjectCreate } from './components/project-create.js';
import { ProjectRemove } from './components/project-remove.js';

// Store components
import { StoreExplorer } from './components/store-explorer.js';

// Resource components
import { ResourceList } from './components/resource-list.js';
import { ResourceSync } from './components/resource-sync.js';
import { ResourceClear } from './components/resource-clear.js';
import { ResourceDelete } from './components/resource-delete.js';
import { ResourceUpload } from './components/resource-upload.js';
import { ResourceTypes } from './components/resource-types.js';

// Shared
import { ErrorComponent } from './components/error.js';
import { ProjectConfigManager } from './commands/project-config-manager.js';
import { scanLocalResources } from './commands/helpers.js';

export interface CliOptions {
  argv?: string[];
  server?: PositronicDevServer;
  exitProcess?: boolean;
  render: (element: React.ReactElement) => any;
  projectRootPath?: string;
}

// Helper function to parse key=value options
function parseKeyValueOptions(
  opts: string[] | undefined
): Record<string, string> | undefined {
  if (!opts || opts.length === 0) return undefined;

  const parsed: Record<string, string> = {};
  for (const opt of opts) {
    const [key, ...valueParts] = opt.split('=');
    const value = valueParts.join('=');

    if (!key || !value) {
      throw new Error(
        `Invalid option format: "${opt}". Options must be in key=value format.`
      );
    }

    parsed[key] = value;
  }
  return parsed;
}

// Helper function to parse key=value state values with type coercion
function parseStateValues(
  opts: string[] | undefined
): Record<string, unknown> | undefined {
  if (!opts || opts.length === 0) return undefined;

  const parsed: Record<string, unknown> = {};
  for (const opt of opts) {
    const [key, ...valueParts] = opt.split('=');
    const raw = valueParts.join('=');

    if (!key || raw === undefined || raw === '') {
      throw new Error(
        `Invalid state format: "${opt}". State values must be in key=value format.`
      );
    }

    // Type coercion
    if (raw === 'true') {
      parsed[key] = true;
    } else if (raw === 'false') {
      parsed[key] = false;
    } else if (raw !== '' && !isNaN(Number(raw))) {
      parsed[key] = Number(raw);
    } else {
      parsed[key] = raw;
    }
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

  function renderLocalDevOnly() {
    render(
      React.createElement(ErrorComponent, {
        error: {
          title: 'Command Not Available',
          message: 'This command is only available in local dev mode',
          details:
            'Please run this command from within a Positronic project directory.',
        },
      })
    );
  }

  type Argv = ReturnType<typeof yargs>;

  function registerBrainCommands(
    yargsInstance: Argv,
    { prefix, topLevelRunAlias }: { prefix: string; topLevelRunAlias: boolean }
  ): Argv {
    const p = prefix ? `${prefix} ` : '';

    yargsInstance
      .command(
        'list',
        'List all brains in the active project\n',
        () => {},
        () => {
          render(React.createElement(BrainList));
        }
      )
      .command(
        'history <brain>',
        'List recent runs of a specific brain\n',
        (yargsHistory) => {
          let y = yargsHistory
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
            .example(
              `$0 ${p}history my-brain`,
              'List recent runs for my-brain'
            );
          if (!prefix) {
            y = y.example(`$0 ${p}history "My Brain Title"`, 'Search by title');
          }
          return y.example(
            `$0 ${p}history my-brain --limit=20`,
            'List more recent runs'
          );
        },
        (argv) => {
          render(
            React.createElement(BrainResolver, {
              identifier: argv.brain,
              children: (resolvedBrainTitle: string) =>
                React.createElement(BrainHistory, {
                  brainName: resolvedBrainTitle,
                  limit: argv.limit,
                }),
            })
          );
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
                throw new Error(
                  'You must provide either a brain identifier or a --run-id.'
                );
              }
              return true;
            })
            .example(`$0 ${p}show my-brain`, 'Show info about my-brain')
            .example(
              `$0 ${p}show my-brain --steps`,
              'Show my-brain with step structure'
            )
            .example(
              `$0 ${p}show --run-id abc123`,
              'Show details for a specific run'
            );
        },
        (argv) => {
          if (argv.runId) {
            render(
              React.createElement(RunShow, { runId: argv.runId as string })
            );
          } else if (argv.brain) {
            render(
              React.createElement(BrainShow, {
                identifier: argv.brain,
                showSteps: argv.steps || false,
              })
            );
          } else {
            render(
              React.createElement(ErrorComponent, {
                error: {
                  title: 'Missing Argument',
                  message:
                    'You must provide either a brain identifier or a run ID.',
                  details:
                    'Use: show <brain> to show brain info, or show --run-id <id> to show run info.',
                },
              })
            );
          }
        }
      )
      .command(
        ['rerun <run-id>', 'rr <run-id>'],
        'Rerun an existing brain run from a specific step\n',
        (yargsRerun) => {
          return yargsRerun
            .positional('run-id', {
              describe: 'ID of the brain run to rerun',
              type: 'string',
              demandOption: true,
            })
            .option('starts-at', {
              describe: 'Step number to start execution from (1-indexed)',
              type: 'number',
              demandOption: true,
            })
            .alias('starts-at', 's')
            .example(`$0 ${p}rerun abc123 --starts-at=3`, 'Rerun from step 3');
        },
        (argv) => {
          render(
            React.createElement(BrainRerun, {
              runId: argv.runId as string,
              startsAt: argv.startsAt as number,
            })
          );
        }
      )
      .command(
        topLevelRunAlias ? ['run <brain>', 'r <brain>'] : 'run <brain>',
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
              coerce: parseKeyValueOptions,
            })
            .option('state', {
              describe:
                'Initial state values (key=value format, with type coercion)',
              type: 'array',
              alias: 's',
              string: true,
              coerce: parseStateValues,
            })
            .option('state-json', {
              describe: 'Initial state as a JSON string',
              type: 'string',
            })
            .check((argv) => {
              if (argv.state && argv.stateJson) {
                throw new Error(
                  'Cannot use both --state/-s and --state-json at the same time.'
                );
              }
              return true;
            })
            .example(`$0 ${p}run my-brain`, 'Run a brain by filename')
            .example(`$0 ${p}run "Email Digest"`, 'Run a brain by title')
            .example(
              `$0 ${p}run email`,
              'Fuzzy search for brains matching "email"'
            )
            .example(
              `$0 ${p}run my-brain --watch`,
              'Run a brain and watch its execution'
            )
            .example(
              `$0 ${p}run my-brain -o channel=#general -o debug=true`,
              'Run a brain with options'
            )
            .example(
              `$0 ${p}run my-brain -s count=0 -s name=sean`,
              'Run a brain with initial state'
            )
            .example(
              `$0 ${p}run my-brain --state-json '{"items": [], "config": {"debug": true}}'`,
              'Run a brain with initial state from JSON'
            );
        },
        (argv) => {
          let initialState: Record<string, unknown> | undefined;
          if (argv.stateJson) {
            try {
              initialState = JSON.parse(argv.stateJson as string);
            } catch {
              console.error(`Invalid JSON for --state-json: ${argv.stateJson}`);
              process.exit(1);
            }
          } else if (argv.state) {
            initialState = argv.state as Record<string, unknown>;
          }
          render(
            React.createElement(BrainRun, {
              identifier: argv.brain,
              watch: argv.watch,
              options: argv.options as Record<string, string> | undefined,
              initialState,
            })
          );
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
              `$0 ${p}watch my-brain`,
              "Watch the latest run of the brain named 'my-brain'"
            )
            .example(
              `$0 ${p}watch abc123def`,
              'Watch a specific brain run by its ID'
            )
            .example(
              `$0 ${p}watch my-brain --events`,
              'Watch with events log view'
            );
        },
        (argv) => {
          render(
            React.createElement(WatchResolver, {
              identifier: argv.identifier,
              startWithEvents: argv.events,
            })
          );
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
            .example(`$0 ${p}top`, 'View all running brains')
            .example(
              `$0 ${p}top my-brain`,
              'View running brains matching "my-brain"'
            );
        },
        (argv) => {
          render(
            React.createElement(TopNavigator, { brainFilter: argv.brain })
          );
        }
      );

    return yargsInstance;
  }

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

  const configManager = new ProjectConfigManager();

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
            render(
              React.createElement(ProjectCreate, {
                projectPathArg: argv.name,
              })
            );
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
            render(
              React.createElement(ProjectAdd, {
                name: argv.name,
                url: argv.url,
                projectConfig: configManager,
              })
            );
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
            render(
              React.createElement(ProjectSelect, {
                name: argv.name,
                projectConfig: configManager,
              })
            );
          }
        )
        .command(
          'list',
          'List all of your Positronic projects',
          () => {},
          () => {
            render(
              React.createElement(ProjectList, {
                projectConfig: configManager,
              })
            );
          }
        )
        .command(
          'show',
          'Display your currently selected project',
          () => {},
          () => {
            render(
              React.createElement(ProjectShow, {
                projectConfig: configManager,
              })
            );
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
            render(
              React.createElement(ProjectRemove, {
                name: argv.name,
                projectConfig: configManager,
              })
            );
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
        render(
          React.createElement(ProjectCreate, { projectPathArg: argv.name })
        );
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

  // --- Brain Commands (top-level shortcuts) ---
  registerBrainCommands(cli, { prefix: '', topLevelRunAlias: true });

  // --- Brain Commands (under `brain` subcommand) ---
  cli = cli.command('brain', 'Manage your brains\n', (yargsBrain) => {
    registerBrainCommands(yargsBrain, {
      prefix: 'brain',
      topLevelRunAlias: false,
    });

    yargsBrain
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
          render(
            React.createElement(BrainKill, {
              runId: argv.runId as string,
              force: argv.force,
            })
          );
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
          render(React.createElement(ResourceList));
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
          if (!server) {
            renderLocalDevOnly();
            return;
          }

          const resourcesDir = join(server.projectRootDir, 'resources');
          if (!existsSync(resourcesDir)) {
            mkdirSync(resourcesDir, { recursive: true });
          }
          const localResources = scanLocalResources(resourcesDir);

          render(
            React.createElement(ResourceSync, {
              localResources,
              resourcesDir,
            })
          );
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
          if (!server) {
            renderLocalDevOnly();
            return;
          }

          render(
            React.createElement(ResourceTypes, {
              projectRootDir: server.projectRootDir,
            })
          );
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
        () => {
          render(React.createElement(ResourceClear));
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
            render(
              React.createElement(ResourceDelete, {
                resourceKey: argv.file as string,
                resourcePath: argv.file as string,
                projectRootPath: server?.projectRootDir,
                force: argv.force as boolean,
              })
            );
          } else {
            render(
              React.createElement(ResourceUpload, {
                filePath: argv.file as string,
                customKey: argv.key as string | undefined,
                projectRootPath: server?.projectRootDir,
              })
            );
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
            argv._.includes('timezone'),
          ].filter(Boolean).length;

          if (operations === 0) {
            throw new Error(
              'You must specify an operation: create, -l (list), -d (delete), runs, or timezone'
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
          const result = render(
            React.createElement(ScheduleList, {
              brainFilter: argv.brain as string | undefined,
            })
          );
          // Wait for the component to finish rendering (in production, Ink's render returns waitUntilExit)
          if (result && typeof result.waitUntilExit === 'function') {
            await result.waitUntilExit();
          }
          // Exit after completion to prevent further command processing
          process.exit(0);
        }
        // If -d flag is used, call delete command
        if (argv.delete) {
          const result = render(
            React.createElement(ScheduleDelete, {
              scheduleId: argv.delete as string,
              force: argv.force as boolean,
            })
          );
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
          ['create <brain> <cron-expression>', 'c <brain> <cron-expression>'],
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
              .option('options', {
                describe:
                  'Options to pass to the brain on each run (key=value format)',
                type: 'array',
                alias: 'o',
                string: true,
                coerce: parseKeyValueOptions,
              })
              .option('state', {
                describe:
                  'Initial state values for each run (key=value format, with type coercion)',
                type: 'array',
                alias: 's',
                string: true,
                coerce: parseStateValues,
              })
              .option('state-json', {
                describe: 'Initial state as a JSON string',
                type: 'string',
              })
              .check((argv) => {
                if (argv.state && argv.stateJson) {
                  throw new Error(
                    'Cannot use both --state/-s and --state-json at the same time.'
                  );
                }
                return true;
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
              )
              .example(
                '$0 schedule create my-brain "0 8 * * 1" -o notify=sean,jim',
                'Run with options passed to the brain'
              )
              .example(
                '$0 schedule create my-brain "0 3 * * *" -s environment=staging',
                'Run with initial state'
              );
          },
          (argv) => {
            let initialState: Record<string, unknown> | undefined;
            if (argv.stateJson) {
              try {
                initialState = JSON.parse(argv.stateJson as string);
              } catch {
                console.error(
                  `Invalid JSON for --state-json: ${argv.stateJson}`
                );
                process.exit(1);
              }
            } else if (argv.state) {
              initialState = argv.state as Record<string, unknown>;
            }
            render(
              React.createElement(BrainResolver, {
                identifier: argv.brain,
                children: (resolvedBrainTitle: string) =>
                  React.createElement(ScheduleCreate, {
                    identifier: resolvedBrainTitle,
                    cronExpression: argv.cronExpression as string,
                    options: argv.options as Record<string, string> | undefined,
                    initialState,
                  }),
              })
            );
          }
        )
        .command(
          'timezone [timezone]',
          'Get or set the project timezone for schedules\n',
          (yargsTimezone) => {
            return yargsTimezone
              .positional('timezone', {
                describe:
                  'IANA timezone (e.g., "America/Chicago", "Europe/London")',
                type: 'string',
              })
              .example('$0 schedule timezone', 'Show current project timezone')
              .example(
                '$0 schedule timezone America/Chicago',
                'Set timezone to Central'
              );
          },
          (argv) => {
            render(
              React.createElement(ScheduleTimezone, {
                timezone: argv.timezone,
              })
            );
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
            render(
              React.createElement(ScheduleRuns, {
                scheduleId: argv.scheduleId as string | undefined,
                limit: argv.limit,
                status: argv.status as
                  | 'triggered'
                  | 'failed'
                  | 'complete'
                  | undefined,
              })
            );
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
        .command('list', 'List all pages\n', {}, () => {
          render(React.createElement(PagesList));
        })
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
            render(
              React.createElement(PageDelete, {
                slug: argv.slug,
                force: argv.force,
              })
            );
          }
        )
        .demandCommand(1, 'You need to specify a subcommand');

      return yargsPages;
    }
  );

  // --- Secrets Management Commands ---
  cli = cli.command(
    'secrets',
    'Manage secrets for your brains\n',
    (yargsSecret) => {
      yargsSecret
        .command('list', 'List all secrets\n', {}, () => {
          render(React.createElement(SecretsList));
        })
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
                '$0 secrets create ANTHROPIC_API_KEY',
                'Create a secret with secure input'
              )
              .example(
                '$0 secrets create DATABASE_URL --value "postgres://..."',
                'Create a secret with direct value (not recommended)'
              );
          },
          (argv) => {
            render(
              React.createElement(SecretsCreate, {
                name: argv.name,
                value: argv.value,
              })
            );
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
                '$0 secrets delete ANTHROPIC_API_KEY',
                'Delete a secret'
              );
          },
          (argv) => {
            render(React.createElement(SecretsDelete, { name: argv.name }));
          }
        )
        .command(
          'bulk [file]',
          'Bulk upload secrets from a .env file\n',
          (yargsBulk) => {
            return yargsBulk
              .positional('file', {
                describe:
                  'Path to the .env file (defaults to .env in project root)',
                type: 'string',
              })
              .example(
                '$0 secrets bulk',
                'Upload secrets from .env file in project root'
              )
              .example(
                '$0 secrets bulk .env.production',
                'Upload secrets from a specific .env file'
              );
          },
          (argv) => {
            render(React.createElement(SecretsBulk, { file: argv.file }));
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
        .command('list', 'List all users\n', {}, () => {
          render(React.createElement(UsersList));
        })
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
            render(React.createElement(UsersCreate, { name: argv.name }));
          }
        )
        .command(
          'delete <name>',
          'Delete a user\n',
          (yargsDelete) => {
            return yargsDelete
              .positional('name', {
                describe: 'Name of the user to delete',
                type: 'string',
                demandOption: true,
              })
              .option('force', {
                describe: 'Skip confirmation prompt',
                type: 'boolean',
                alias: 'f',
                default: false,
              })
              .example('$0 users delete admin', 'Delete a user')
              .example(
                '$0 users delete admin --force',
                'Delete without confirmation'
              );
          },
          (argv) => {
            render(
              React.createElement(UsersDelete, {
                userName: argv.name,
                force: argv.force,
              })
            );
          }
        )
        .command(
          'list-keys <name>',
          'List keys for a user\n',
          (yargsKeysList) => {
            return yargsKeysList
              .positional('name', {
                describe: 'Name of the user',
                type: 'string',
                demandOption: true,
              })
              .example('$0 users list-keys admin', 'List keys for a user');
          },
          (argv) => {
            render(React.createElement(UsersKeysList, { userName: argv.name }));
          }
        )
        .command(
          'add-key <name> [pubkey-path]',
          'Add an SSH public key to a user\n',
          (yargsAdd) => {
            return yargsAdd
              .positional('name', {
                describe: 'Name of the user',
                type: 'string',
                demandOption: true,
              })
              .positional('pubkey-path', {
                describe: 'Path to the SSH public key file',
                type: 'string',
              })
              .option('paste', {
                describe: 'Paste a public key from clipboard',
                type: 'boolean',
                default: false,
              })
              .option('label', {
                describe: 'Label for the key (e.g., "laptop", "desktop")',
                type: 'string',
                alias: 'l',
              })
              .check((argv) => {
                if (!argv.pubkeyPath && !argv.paste) {
                  throw new Error(
                    'You must provide a pubkey-path or use --paste'
                  );
                }
                return true;
              })
              .example(
                '$0 users add-key admin ~/.ssh/id_ed25519.pub',
                'Add an SSH public key'
              )
              .example(
                '$0 users add-key admin --paste',
                'Paste a public key interactively'
              )
              .example(
                '$0 users add-key admin ~/.ssh/id_ed25519.pub --label laptop',
                'Add key with label'
              );
          },
          (argv) => {
            render(
              React.createElement(UsersKeysAdd, {
                userName: argv.name,
                pubkeyPath: argv.pubkeyPath,
                paste: argv.paste,
                label: argv.label,
              })
            );
          }
        )
        .command(
          'remove-key <name> <fingerprint>',
          'Remove a key from a user\n',
          (yargsRemove) => {
            return yargsRemove
              .positional('name', {
                describe: 'Name of the user',
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
              .example('$0 users remove-key admin SHA256:...', 'Remove a key');
          },
          (argv) => {
            render(
              React.createElement(UsersKeysRemove, {
                userName: argv.name,
                fingerprint: argv.fingerprint,
                force: argv.force,
              })
            );
          }
        )
        .demandCommand(
          1,
          'You need to specify a users command (list, create, delete, list-keys, add-key, remove-key)'
        );

      return yargsUsers;
    }
  );

  // --- Store Explorer Command ---
  cli = cli.command(
    'store',
    'Browse and manage brain store data\n',
    () => {},
    () => {
      render(React.createElement(StoreExplorer));
    }
  );

  // --- Auth Commands (Top-level) ---
  cli = cli.command(
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
        .example('$0 login', 'Interactive key selection')
        .example('$0 login --path ~/.ssh/id_ed25519', 'Set key directly')
        .example('$0 login --project', 'Set key for current project');
    },
    (argv) => {
      render(
        React.createElement(AuthLogin, {
          configManager,
          keyPath: argv.path,
          forProject: argv.project || false,
          projectRootPath,
        })
      );
    }
  );

  cli = cli.command(
    'logout',
    'Clear SSH key configuration\n',
    (yargsLogout) => {
      return yargsLogout
        .option('project', {
          describe: 'Clear key for current project only',
          type: 'boolean',
          default: false,
        })
        .example('$0 logout', 'Clear global key configuration')
        .example('$0 logout --project', 'Clear project-specific key');
    },
    (argv) => {
      render(
        React.createElement(AuthLogout, {
          configManager,
          forProject: argv.project || false,
          projectRootPath,
        })
      );
    }
  );

  cli = cli.command(
    'whoami',
    'Show your current authenticated identity\n',
    () => {},
    () => {
      render(
        React.createElement(Whoami, {
          configManager,
          projectRootPath,
        })
      );
    }
  );

  cli = cli.epilogue('For more information, visit https://positronic.sh');

  return cli;
}
