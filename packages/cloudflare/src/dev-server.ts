import * as path from 'path';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';
import caz from 'caz';
import type { PositronicDevServer } from '@positronic/spec';
// @ts-ignore Could not find a declaration file for module '@positronic/template-new-project'.
import pkg from '@positronic/template-new-project';
const { generateManifest: regenerateManifestFile } = pkg;

async function generateProject(
  projectName: string,
  projectDir: string,
  onSuccess?: () => Promise<void> | void
) {
  const devPath = process.env.POSITRONIC_LOCAL_PATH;
  let newProjectTemplatePath = '@positronic/template-new-project';
  let cazOptions: {
    name: string;
    backend?: string;
    install?: boolean;
    pm?: string;
  } = { name: projectName };

  try {
    if (devPath) {
      // Copying templates, why you ask?
      // Well because when caz runs if you pass it a path to the template module
      // (e.g. for development environment setting POSITRONIC_LOCAL_PATH)
      // it runs npm install --production in the template directory. This is a problem
      // in our monorepo because this messes up the node_modules at the root of the
      // monorepo which then causes the tests to fail. Also any time I was generating a new
      // project it was a pain to have to run npm install over and over again just
      // to get back to a good state.
      const originalNewProjectPkg = path.resolve(
        devPath,
        'packages',
        'template-new-project'
      );
      const copiedNewProjectPkg = fs.mkdtempSync(
        path.join(os.tmpdir(), 'positronic-newproj-')
      );
      fs.cpSync(originalNewProjectPkg, copiedNewProjectPkg, {
        recursive: true,
      });
      newProjectTemplatePath = copiedNewProjectPkg;
      cazOptions = {
        name: projectName,
        backend: 'cloudflare',
        install: true,
        pm: 'npm',
      };
    }

    await caz.default(newProjectTemplatePath, projectDir, {
      ...cazOptions,
      force: false,
    });

    await onSuccess?.();
  } finally {
    // Clean up the temporary copied new project package
    if (devPath) {
      fs.rmSync(newProjectTemplatePath, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }
}

export class CloudflareDevServer implements PositronicDevServer {
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
  async setup(projectRoot: string, force?: boolean): Promise<void> {
    const serverDir = path.join(projectRoot, '.positronic');
    const serverDirExists = await fsPromises
      .access(serverDir)
      .then(() => true)
      .catch(() => false);

    if (!serverDirExists || force) {
      console.log(
        force
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
        const tempProjectName = 'temp-positronic-gen';
        await generateProject(tempProjectName, tempDir, async () => {
          const sourcePositronicDir = path.join(tempDir!, '.positronic');
          const targetPositronicDir = serverDir;

          // If forcing setup, remove existing target first
          if (serverDirExists && force) {
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

    // Handle .env file conversion to .dev.vars
    const rootEnvFilePath = path.join(projectRoot, '.env');
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

    // Regenerate manifest based on actual project state
    const srcDir = path.join(serverDir, 'src');
    await regenerateManifestFile(projectRoot, srcDir);
  }

  async start(projectRoot: string, port?: number): Promise<ChildProcess> {
    const serverDir = path.join(projectRoot, '.positronic');

    // Start wrangler dev server
    const wranglerArgs = ['dev', '--local'];
    if (port) {
      wranglerArgs.push('--port', String(port));
    }

    const wranglerProcess = spawn('npx', ['wrangler', ...wranglerArgs], {
      cwd: serverDir,
      stdio: 'inherit',
      shell: true,
    });

    wranglerProcess.on('error', (err) => {
      console.error('Failed to start Wrangler dev server:', err);
    });

    return wranglerProcess;
  }

  async watch(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    // Regenerate manifest when brain files change
    const serverDir = path.join(projectRoot, '.positronic');
    const srcDir = path.join(serverDir, 'src');

    console.log(`Brain file ${event}: ${path.relative(projectRoot, filePath)}`);
    await regenerateManifestFile(projectRoot, srcDir);
  }
}
