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
      let backendPackage = '@positronic/cloudflare'; // Default fallback

      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.backend?.package) {
          backendPackage = config.backend.package;
        } else if (config.backend?.type === 'cloudflare') {
          // Legacy support for configs without package field
          backendPackage = '@positronic/cloudflare';
        }
      } catch (error) {
        console.warn(
          `Warning: Could not read backend configuration from ${configPath}, using default: ${backendPackage}`
        );
      }

      // Handle different package types
      if (backendPackage.startsWith('file:')) {
        // Direct file path from config
        const packagePath = backendPackage.replace('file:', '');
        const localModulePath = path.join(
          packagePath,
          'dist',
          'src',
          'node-index.js'
        );
        try {
          const localPackage = await import(localModulePath);
          // Try common export patterns
          const DevServerClass =
            localPackage.DevServer ||
            localPackage.CloudflareDevServer ||
            localPackage.default?.DevServer;
          if (!DevServerClass) {
            throw new Error(
              `Backend package at '${packagePath}' does not export a DevServer class`
            );
          }
          devServer = new DevServerClass();
        } catch (error: any) {
          console.error(`Failed to load local backend from ${localModulePath}`);
          console.error(`Error: ${error.message}`);
          console.error(`Make sure the backend package is built.`);
          process.exit(1);
        }
      } else if (
        process.env.POSITRONIC_LOCAL_PATH &&
        backendPackage.startsWith('@positronic/')
      ) {
        // Handle @positronic/ packages with POSITRONIC_LOCAL_PATH override
        const packageName = backendPackage.replace('@positronic/', '');
        const localPath = path.resolve(
          process.env.POSITRONIC_LOCAL_PATH,
          'packages',
          packageName
        );
        if (fs.existsSync(localPath)) {
          // Import from local path - use the built output
          const localModulePath = path.join(
            localPath,
            'dist',
            'src',
            'node-index.js'
          );
          try {
            const localPackage = await import(localModulePath);
            // Try common export patterns
            const DevServerClass =
              localPackage.DevServer ||
              localPackage.CloudflareDevServer ||
              localPackage.default?.DevServer;
            if (!DevServerClass) {
              throw new Error(
                `Backend package '${backendPackage}' does not export a DevServer class`
              );
            }
            devServer = new DevServerClass();
          } catch (error: any) {
            console.error(
              `Failed to load local backend from ${localModulePath}`
            );
            console.error(`Error: ${error.message}`);
            console.error(`Make sure the backend package is built.`);
            process.exit(1);
          }
        } else {
          // Fallback to npm package
          try {
            const backendModule = await import(backendPackage);
            const DevServerClass =
              backendModule.DevServer ||
              backendModule.CloudflareDevServer ||
              backendModule.default?.DevServer;
            if (!DevServerClass) {
              throw new Error(
                `Backend package '${backendPackage}' does not export a DevServer class`
              );
            }
            devServer = new DevServerClass();
          } catch (error: any) {
            console.error(
              `Failed to load backend '${backendPackage}'. Is it installed?`
            );
            console.error(`Error: ${error.message}`);
            console.error(`Try running: npm install ${backendPackage}`);
            process.exit(1);
          }
        }
      } else {
        // Normal npm package import
        try {
          const backendModule = await import(backendPackage);
          const DevServerClass =
            backendModule.DevServer ||
            backendModule.CloudflareDevServer ||
            backendModule.default?.DevServer;
          if (!DevServerClass) {
            throw new Error(
              `Backend package '${backendPackage}' does not export a DevServer class`
            );
          }
          devServer = new DevServerClass();
        } catch (error: any) {
          console.error(
            `Failed to load backend '${backendPackage}'. Is it installed?`
          );
          console.error(`Error: ${error.message}`);
          console.error(`Try running: npm install ${backendPackage}`);
          process.exit(1);
        }
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
      const isReady = await waitUntilReady(argv.port);

      if (!isReady) {
        console.error(
          'Warning: Server did not become ready within timeout period'
        );
      }

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
