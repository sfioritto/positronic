import * as path from 'path';
import { type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import { syncResources, generateTypes } from './helpers.js';
import type { PositronicDevServer } from '@positronic/spec';

export class ServerCommand {
  constructor(private devServer: PositronicDevServer) {}

  async handle(argv: ArgumentsCamelCase<any>, projectRootPath: string | null) {
    if (!projectRootPath) {
      console.error(
        'Error: Not inside a Positronic project. Cannot start server.'
      );
      console.error(
        "Navigate to your project directory or use 'positronic project new <name>' to create one."
      );
      process.exit(1);
    }

    const brainsDir = path.join(projectRootPath, 'brains');
    const resourcesDir = path.join(projectRootPath, 'resources');

    let serverProcess: ChildProcess | null = null;
    let watcher: FSWatcher | null = null;

    const cleanup = async () => {
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      if (serverProcess && !serverProcess.killed) {
        const killedGracefully = serverProcess.kill('SIGTERM');
        if (killedGracefully) {
          // Wait a short period for potential cleanup
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!serverProcess.killed) {
            // Check if it terminated
            console.warn(
              '- Server did not exit after SIGTERM, sending SIGKILL.'
            );
            serverProcess.kill('SIGKILL');
          }
        } else {
          // If SIGTERM fails immediately (e.g., process doesn't exist)
          console.warn(
            '- Failed to send SIGTERM to server (process might have already exited). Attempting SIGKILL.'
          );
          serverProcess.kill('SIGKILL'); // Force kill if SIGTERM fails
        }
        serverProcess = null;
        console.log('- Server process terminated.');
      }
      console.log('Cleanup complete. Exiting.');
      process.exit(0);
    };

    process.on('SIGINT', cleanup); // Catches Ctrl+C
    process.on('SIGTERM', cleanup); // Catches kill commands

    try {
      // Use the dev server's setup method
      await this.devServer.setup(projectRootPath, argv.force);

      // Use the dev server's start method
      serverProcess = await this.devServer.start(projectRootPath, argv.port);

      serverProcess.on('close', (code) => {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(code ?? 1); // Exit with server's code or 1 if null
      });

      serverProcess.on('error', (err) => {
        console.error('Failed to start dev server:', err);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(1);
      });

      // Wait a moment for the server to start before syncing resources
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Initial resource sync and type generation
      const syncResult = await syncResources(projectRootPath);
      if (syncResult.errorCount > 0) {
        console.log(
          `⚠️  Resource sync completed with ${syncResult.errorCount} errors:`
        );
        syncResult.errors.forEach((error) => {
          console.log(`   • ${error.file}: ${error.message}`);
        });
      } else {
        console.log(
          `✅ Synced ${syncResult.uploadCount} resources (${syncResult.skipCount} up to date)`
        );
      }

      await generateTypes(projectRootPath);

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
        await syncResources(projectRootPath);
        await generateTypes(projectRootPath);
      };

      watcher
        .on('add', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.devServer.watch) {
              await this.devServer.watch(projectRootPath, filePath, 'add');
            }
          }
        })
        .on('change', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.devServer.watch) {
              await this.devServer.watch(projectRootPath, filePath, 'change');
            }
          }
        })
        .on('unlink', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (this.devServer.watch) {
              await this.devServer.watch(projectRootPath, filePath, 'unlink');
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
