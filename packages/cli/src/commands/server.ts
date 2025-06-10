import * as path from 'path';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import * as dotenv from 'dotenv';
import { generateProject } from './helpers.js';
// @ts-ignore Could not find a declaration file for module '@positronic/template-new-project'.
import pkg from '@positronic/template-new-project';
const { generateManifest: regenerateManifestFile } = pkg;

/**
 * Sets up the .positronic server environment directory.
 * If the directory is missing or forceSetup is true, it generates the
 * full project in a temporary directory and copies the .positronic
 * part into the actual project.
 *
 * Doing it this way because it's tricky to split the template-new-project
 * into a template-cloudflare without lots of extra code, was better to combine
 * backend templates into a single template-new-project. But then we still need
 * a way to generate the .positronic directory if it's not there, so this is the
 * simplest solution.
 */
async function setupPositronicServerEnv(
  projectRootPath: string,
  forceSetup: boolean = false
) {
  const serverDir = path.join(projectRootPath, '.positronic');
  const serverDirExists = await fsPromises
    .access(serverDir)
    .then(() => true)
    .catch(() => false);

  if (!serverDirExists || forceSetup) {
    console.log(
      forceSetup
        ? 'Forcing regeneration of .positronic environment...'
        : 'Missing .positronic environment, generating...'
    );
    let tempDir: string | undefined;
    try {
      // Create a temp directory to generate the project in
      // so we can copy the .positronic directory to the user's project
      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'positronic-server-setup-')
      );
      const tempProjectName = 'temp-positronic-gen'; // Name used for temp generation
      await generateProject(tempProjectName, tempDir, async () => {
        const sourcePositronicDir = path.join(tempDir!, '.positronic');
        const targetPositronicDir = serverDir;

        // If forcing setup, remove existing target first
        if (serverDirExists && forceSetup) {
          await fsPromises.rm(targetPositronicDir, {
            recursive: true,
            force: true,
          });
        }

        // Copy the generated .positronic directory
        await fsPromises.cp(sourcePositronicDir, targetPositronicDir, {
          recursive: true,
        });
      });
    } finally {
      // Clean up the temporary generation directory
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  const rootEnvFilePath = path.join(projectRootPath, '.env');
  const devVarsPath = path.join(serverDir, '.dev.vars');
  let devVarsContent = '';

  if (fs.existsSync(rootEnvFilePath)) {
    const rootEnvFileContent = fs.readFileSync(rootEnvFilePath);
    const parsedRootEnv = dotenv.parse(rootEnvFileContent);
    if (Object.keys(parsedRootEnv).length > 0) {
      devVarsContent =
        Object.entries(parsedRootEnv)
          .map(([key, value]) => `${key}="${value.replace(/"/g, '\\\\"')}"`)
          .join('\n') + '\n';
    }
  }
  fs.writeFileSync(devVarsPath, devVarsContent);

  // Regenerate manifest based on actual project state AFTER setup/copy
  const srcDir = path.join(serverDir, 'src');
  await regenerateManifestFile(projectRootPath, srcDir);
}

// --- ServerCommand Class ---

export class ServerCommand {
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

    const serverDir = path.join(projectRootPath, '.positronic');
    const srcDir = path.join(serverDir, 'src'); // Still needed for watcher path
    const brainsDir = path.join(projectRootPath, 'brains'); // Still needed for watcher path
    const resourcesDir = path.join(projectRootPath, 'resources'); // For resource watching

    let wranglerProcess: ChildProcess | null = null;
    let watcher: FSWatcher | null = null;

    const cleanup = async () => {
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      if (wranglerProcess && !wranglerProcess.killed) {
        const killedGracefully = wranglerProcess.kill('SIGTERM');
        if (killedGracefully) {
          // Wait a short period for potential cleanup within Wrangler
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!wranglerProcess.killed) {
            // Check if it terminated
            console.warn(
              '- Wrangler did not exit after SIGTERM, sending SIGKILL.'
            );
            wranglerProcess.kill('SIGKILL');
          }
        } else {
          // If SIGTERM fails immediately (e.g., process doesn't exist)
          console.warn(
            '- Failed to send SIGTERM to Wrangler (process might have already exited). Attempting SIGKILL.'
          );
          wranglerProcess.kill('SIGKILL'); // Force kill if SIGTERM fails
        }
        wranglerProcess = null;
        console.log('- Wrangler process terminated.');
      }
      console.log('Cleanup complete. Exiting.');
      process.exit(0);
    };

    process.on('SIGINT', cleanup); // Catches Ctrl+C
    process.on('SIGTERM', cleanup); // Catches kill commands

    try {
      await setupPositronicServerEnv(projectRootPath, argv.force);

      // Watcher setup - target the user's brains and resources directories
      const watchPaths = [
        path.join(brainsDir, '*.ts'),
        path.join(resourcesDir, '**/*'),
      ];

      watcher = chokidar.watch(watchPaths, {
        ignored: [/(^|[\/\\])\../, '**/node_modules/**'], // Ignore dotfiles and node_modules
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });

      const regenerate = async () => {
        await regenerateManifestFile(projectRootPath, srcDir);
      };

      watcher
        .on('add', regenerate)
        .on('change', regenerate)
        .on('unlink', regenerate)
        .on('error', (error) => console.error(`Watcher error: ${error}`));

      // Start dev server
      const wranglerArgs = ['dev', '--local'];
      if (argv.port) {
        wranglerArgs.push('--port', String(argv.port));
      }

      const npxBaseCommand = 'npx';

      wranglerProcess = spawn(npxBaseCommand, ['wrangler', ...wranglerArgs], {
        cwd: serverDir,
        stdio: 'inherit', // Show wrangler output directly
        shell: true, // Use shell for better compatibility, especially on Windows
      });

      wranglerProcess.on('close', (code) => {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(code ?? 1); // Exit with wrangler's code or 1 if null
      });

      wranglerProcess.on('error', (err) => {
        console.error('Failed to start Wrangler dev server:', err);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        process.exit(1);
      });
    } catch (error) {
      console.error('An error occurred during server startup:', error);
      await cleanup(); // Attempt cleanup on error
    }
  }
}
