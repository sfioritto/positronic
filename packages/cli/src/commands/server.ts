import * as path from 'path';
import { type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import { syncResources, generateTypes, waitUntilReady } from './helpers.js';
import type { PositronicDevServer } from '@positronic/spec';
import * as fs from 'fs';

export class ServerCommand {
  constructor() {}

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

    // Get the appropriate dev server instance
    let devServer: PositronicDevServer;
    if (process.env.POSITRONIC_TEST_MODE) {
      const { TestDevServer } = await import('../test/test-dev-server.js');
      devServer = new TestDevServer();
    } else {
      // Read the backend configuration from positronic.config.json
      const configPath = path.join(projectRootPath, 'positronic.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!config.backend) {
        throw new Error(
          'No backend configuration found in positronic.config.json'
        );
      }
      const backendPackage = config.backend.package;
      if (backendPackage.startsWith('file:')) {
        const packagePath = backendPackage.replace('file:', '');
        const localModulePath = path.join(
          packagePath,
          'dist',
          'src',
          'node-index.js'
        );
        const { DevServer } = await import(localModulePath);
        devServer = new DevServer();
      } else {
        const { DevServer } = await import(backendPackage);
        devServer = new DevServer();
      }
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
      await devServer.setup(projectRootPath, argv.force);

      // Use the dev server's start method
      serverProcess = await devServer.start(projectRootPath, argv.port);

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
      // Wait for the server to be ready before syncing resources
      const isReady = await waitUntilReady(argv.port, 15000);

      if (!isReady) {
        console.error(
          '⚠️  Server startup timeout: The server is taking longer than expected to initialize.'
        );
        console.error(
          '\nThis often happens when you have a large number of resources that need to be loaded.'
        );
        console.error('\nTo resolve this, try the following:');
        console.error(
          '  1. Run `px resources sync` in a separate terminal to sync your resources first'
        );
        console.error(
          '  2. Once the sync is complete, restart the server with `px server`'
        );
        console.error(
          '\nThis will pre-populate the server with your resources and speed up initialization.'
        );

        // Clean up and exit
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGTERM');
        }
        process.exit(1);
      }

      // Initial resource sync and type generation
      try {
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
        await syncResources(projectRootPath);
        await generateTypes(projectRootPath);
      };

      watcher
        .on('add', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (devServer.watch) {
              await devServer.watch(projectRootPath, filePath, 'add');
            }
          }
        })
        .on('change', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (devServer.watch) {
              await devServer.watch(projectRootPath, filePath, 'change');
            }
          }
        })
        .on('unlink', async (filePath) => {
          if (filePath.startsWith(resourcesDir)) {
            await handleResourceChange();
          } else if (filePath.startsWith(brainsDir)) {
            // Call the dev server's watch method if it exists
            if (devServer.watch) {
              await devServer.watch(projectRootPath, filePath, 'unlink');
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
