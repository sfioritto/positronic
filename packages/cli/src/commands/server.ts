import * as path from 'path';
import * as fs from 'fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import { syncResources, generateTypes } from './helpers.js';
import type { PositronicDevServer, ServerHandle } from '@positronic/spec';

export class ServerCommand {
  constructor(private server: PositronicDevServer) {}

  async handle(argv: ArgumentsCamelCase<any>) {
    const brainsDir = path.join(this.server.projectRootDir, 'brains');
    const resourcesDir = path.join(this.server.projectRootDir, 'resources');

    let serverHandle: ServerHandle | null = null;
    let watcher: FSWatcher | null = null;
    let logStream: fs.WriteStream | null = null;

    // Handle log file option
    if (argv.logFile) {
      const logFilePath = path.resolve(argv.logFile);
      
      // Check if file already exists
      if (fs.existsSync(logFilePath)) {
        throw new Error(`Log file already exists: ${logFilePath}. Please specify a different file.`);
      }

      // Create log stream
      logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

      // Register log callbacks
      this.server.onLog((message) => {
        const timestamp = new Date().toISOString();
        logStream!.write(`[${timestamp}] [INFO] ${message}`);
      });

      this.server.onError((message) => {
        const timestamp = new Date().toISOString();
        logStream!.write(`[${timestamp}] [ERROR] ${message}`);
      });

      this.server.onWarning((message) => {
        const timestamp = new Date().toISOString();
        logStream!.write(`[${timestamp}] [WARN] ${message}`);
      });

      // Output the process ID for AI agents to track
      console.log(process.pid);
    }

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
}
