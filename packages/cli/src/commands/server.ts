import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import { syncResources, generateTypes } from './helpers.js';
import type { PositronicDevServer, ServerHandle } from '@positronic/spec';

export class ServerCommand {
  constructor(private server: PositronicDevServer) {}

  async handle(argv: ArgumentsCamelCase<any>) {
    // Handle kill option
    if (argv.k) {
      return this.handleKill(argv);
    }

    // Validate arguments
    if (argv.port && argv.d && !argv.logFile) {
      throw new Error(
        'When using --port with -d, you must also specify --log-file'
      );
    }

    // Check for existing PID file (skip if we're a detached child process)
    const pidFile = this.getPidFilePath(argv.port);
    if (!process.env.POSITRONIC_DETACHED_CHILD && fs.existsSync(pidFile)) {
      const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      if (this.isProcessRunning(existingPid)) {
        throw new Error(
          `Server already running (PID: ${existingPid}). Stop it with: px server -k`
        );
      } else {
        console.log('WARNING: Removing stale PID file');
        fs.unlinkSync(pidFile);
      }
    }

    // If -d flag is set, spawn a detached process
    if (argv.d) {
      return this.handleDetached(argv);
    }

    // Write PID file for foreground process too
    fs.writeFileSync(pidFile, String(process.pid));

    const brainsDir = path.join(this.server.projectRootDir, 'brains');
    const resourcesDir = path.join(this.server.projectRootDir, 'resources');

    let serverHandle: ServerHandle | null = null;
    let watcher: FSWatcher | null = null;
    let logStream: fs.WriteStream | null = null;

    // Always create a log file (use default if not specified)
    const logFilePath = argv.logFile
      ? path.resolve(argv.logFile)
      : path.join(this.server.projectRootDir, '.positronic-server.log');

    // Ensure directory exists
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create log stream (append mode)
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    // Helper function to log to both console and file
    const logBoth = (level: string, message: string) => {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${level}] ${message}\n`;
      if (logStream && !logStream.destroyed) {
        logStream.write(logLine);
      }

      // Also output to console (using original methods to avoid recursion)
      if (level === 'ERROR') {
        console.error(message);
      } else if (level === 'WARN') {
        console.warn(message);
      } else {
        console.log(message);
      }
    };

    // Always register log callbacks to capture server logs
    // The server is responsible for generating logs through these callbacks
    this.server.onLog((message) => logBoth('INFO', message));
    this.server.onError((message) => logBoth('ERROR', message));
    this.server.onWarning((message) => logBoth('WARN', message));

    const cleanup = async () => {
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      if (serverHandle && !serverHandle.killed) {
        serverHandle.kill();
        serverHandle = null;
      }

      // Close log stream
      if (logStream) {
        logStream.end();
        logStream = null;
      }

      // Remove PID file
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      process.exit(0);
    };

    process.on('SIGINT', cleanup); // Catches Ctrl+C
    process.on('SIGTERM', cleanup); // Catches kill commands

    try {
      // Use the dev server's setup method
      await this.server.setup(argv.force);

      // Use the dev server's start method
      serverHandle = await this.server.start(argv.port);

      serverHandle.onClose((code?: number | null) => {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(code ?? 1); // Exit with server's code or 1 if null
      });

      serverHandle.onError((err: Error) => {
        console.error('Failed to start dev server:', err);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(1);
      });
      // Wait for the server to be ready before syncing resources
      const isReady = await serverHandle.waitUntilReady(15000);

      if (!isReady) {
        console.error(
          '⚠️  Server startup timeout: The server is taking longer than expected to initialize.'
        );

        // Clean up and exit
        if (serverHandle && !serverHandle.killed) {
          serverHandle.kill();
        }
        process.exit(1);
      }

      // Initial resource sync and type generation
      try {
        const syncResult = await syncResources(this.server.projectRootDir);
        if (syncResult.errorCount > 0) {
          console.log(
            `⚠️  Resource sync completed with ${syncResult.errorCount} errors:`
          );
          syncResult.errors.forEach((error) => {
            console.log(`   • ${error.file}: ${error.message}`);
          });
        } else {
          console.log(
            `✅ Synced ${syncResult.uploadCount} resources (${syncResult.skipCount} up to date, ${syncResult.deleteCount} deleted)`
          );
        }
        await generateTypes(this.server.projectRootDir);
      } catch (error) {
        console.error(
          '❌ Error during resource synchronization:',
          error instanceof Error ? error.message : String(error)
        );
        console.error(
          '\nThe server is running, but resources may not be available to your brains.'
        );
        console.error(
          '\nYou can manually sync resources by running: px resources sync'
        );
        // Don't exit here - let the server continue running
      }

      // Watcher setup - target the user's brains and resources directories
      const watchPaths = [
        path.join(brainsDir, '*.ts'),
        path.join(resourcesDir, '**/*'),
      ];

      watcher = chokidar.watch(watchPaths, {
        ignored: [/(^|[\/\\])\../, '**/node_modules/**'],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });

      const handleResourceChange = async () => {
        await syncResources(this.server.projectRootDir);
        await generateTypes(this.server.projectRootDir);
      };

      watcher
        .on('add', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.server.watch) {
              await this.server.watch(filePath, 'add');
            }
          }
        })
        .on('change', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.server.watch) {
              await this.server.watch(filePath, 'change');
            }
          }
        })
        .on('unlink', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.server.watch) {
              await this.server.watch(filePath, 'unlink');
            }
          }
        })
        .on('error', (error) => console.error(`Watcher error: ${error}`));
    } catch (error) {
      console.error('An error occurred during server startup:', error);
      await cleanup(); // Attempt cleanup on error
    }
  }

  private async handleDetached(argv: ArgumentsCamelCase<any>) {
    // Get the path to the current CLI executable
    const cliPath = process.argv[1];

    // Build the command arguments
    const args = ['server'];

    // Add optional arguments if they were provided
    if (argv.force) args.push('--force');
    if (argv.port) args.push('--port', String(argv.port));
    if (argv.logFile) args.push('--log-file', argv.logFile);

    // Determine output file for logs
    const logFile =
      argv.logFile ||
      path.join(this.server.projectRootDir, '.positronic-server.log');

    // Open log file in append mode
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    // Spawn the detached process with a special environment variable to skip PID check
    const child = spawn(process.execPath, [cliPath, ...args], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: this.server.projectRootDir,
      env: { ...process.env, POSITRONIC_DETACHED_CHILD: 'true' },
    });

    // Write the PID to a file for later reference
    const pidFile = this.getPidFilePath(argv.port);
    fs.writeFileSync(pidFile, String(child.pid));

    // Detach from the child process
    child.unref();

    console.log(`✅ Server started in background (PID: ${child.pid})`);
    console.log(`   Logs: ${logFile}`);
    console.log(`   To stop: px server -k`);

    // Exit the parent process
    process.exit(0);
  }

  private getPidFilePath(port?: number): string {
    if (port) {
      return path.join(
        this.server.projectRootDir,
        `.positronic-server-${port}.pid`
      );
    }
    return path.join(this.server.projectRootDir, '.positronic-server.pid');
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // This sends signal 0 which doesn't kill the process, just checks if it exists
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  private async handleKill(argv: ArgumentsCamelCase<any>) {
    const pidFile = path.join(this.server.projectRootDir, '.positronic-server.pid');
    
    if (!fs.existsSync(pidFile)) {
      console.error(`❌ No default server is running`);
      console.error(`   PID file not found: ${pidFile}`);
      process.exit(1);
    }

    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      
      if (!this.isProcessRunning(pid)) {
        console.log('⚠️  Server process not found, removing stale PID file');
        fs.unlinkSync(pidFile);
        process.exit(0);
      }

      // Kill the process
      process.kill(pid, 'SIGTERM');
      
      // Wait a moment to see if the process stops
      let killed = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!this.isProcessRunning(pid)) {
          killed = true;
          break;
        }
      }

      if (!killed) {
        // Force kill if SIGTERM didn't work
        console.log('⚠️  Server did not stop gracefully, forcing shutdown');
        process.kill(pid, 'SIGKILL');
      }

      // Clean up PID file
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      console.log(`✅ Server stopped (PID: ${pid})`);
      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to kill server:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}
