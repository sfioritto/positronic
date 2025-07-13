import * as path from 'path';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';
import caz from 'caz';
import type { PositronicDevServer, ServerHandle } from '@positronic/spec';

/**
 * Implementation of ServerHandle that wraps a ChildProcess
 */
class ProcessServerHandle implements ServerHandle {
  private closeCallbacks: Array<(code?: number | null) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private _killed = false;

  constructor(private process: ChildProcess, private port?: number) {
    // Forward process events to registered callbacks
    process.on('close', (code) => {
      this.closeCallbacks.forEach((cb) => cb(code));
    });

    process.on('error', (error) => {
      this.errorCallbacks.forEach((cb) => cb(error));
    });

    process.on('exit', () => {
      this._killed = true;
    });
  }

  onClose(callback: (code?: number | null) => void): void {
    this.closeCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  kill(signal?: string): boolean {
    if (!this._killed && this.process && !this.process.killed) {
      const result = this.process.kill(signal as any);
      if (result) {
        this._killed = true;
      }
      return result;
    }
    return false;
  }

  get killed(): boolean {
    return this._killed || (this.process?.killed ?? true);
  }

  async waitUntilReady(maxWaitMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const port = this.port || 8787;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await fetch(`http://localhost:${port}/status`);
        if (response.ok) {
          const data = (await response.json()) as { ready?: boolean };
          if (data.ready === true) {
            return true;
          }
        }
      } catch (error) {
        // Server not ready yet, continue polling
      }

      // Wait a bit before trying again
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
  }
}

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

async function regenerateManifestFile(
  projectRootPath: string,
  targetSrcDir: string
) {
  const runnerPath = path.join(projectRootPath, 'runner.ts');
  const brainsDir = path.join(projectRootPath, 'brains');
  const manifestPath = path.join(targetSrcDir, '_manifest.ts');

  let importStatements = `import type { Brain } from '@positronic/core';\n`;
  let manifestEntries = '';

  const brainsDirExists = await fsPromises
    .access(brainsDir)
    .then(() => true)
    .catch(() => false);
  if (brainsDirExists) {
    const files = await fsPromises.readdir(brainsDir);
    const brainFiles = files.filter(
      (file) => file.endsWith('.ts') && !file.startsWith('_')
    );

    for (const file of brainFiles) {
      const brainName = path.basename(file, '.ts');
      const importPath = `../../brains/${brainName}.js`;
      const importAlias = `brain_${brainName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

      importStatements += `import * as ${importAlias} from '${importPath}';\n`;
      manifestEntries += `  ${JSON.stringify(
        brainName
      )}: ${importAlias}.default as Brain,\n`;
    }
  }

  const manifestContent = `// This file is generated automatically. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Brain> = {\n${manifestEntries}};
`;

  const runnerContent = await fsPromises.readFile(runnerPath, 'utf-8');
  await fsPromises.mkdir(targetSrcDir, { recursive: true });
  await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');
  await fsPromises.writeFile(
    path.join(targetSrcDir, 'runner.ts'),
    runnerContent,
    'utf-8'
  );
}

export class CloudflareDevServer implements PositronicDevServer {
  // TODO: Future architectural improvements:
  // 1. Extract .positronic directory into its own template package to eliminate temp directory hack
  // 2. Create a declarative configuration model for wrangler updates
  // 3. Move more logic into the template itself using template interpolation
  // 4. Consider a pipeline-based setup process for better composability
  // 5. Separate concerns better between template generation, env syncing, and dynamic configuration

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

  private logCallbacks: Array<(message: string) => void> = [];
  private errorCallbacks: Array<(message: string) => void> = [];
  private warningCallbacks: Array<(message: string) => void> = [];

  constructor(public projectRootDir: string) {}

  async setup(force?: boolean): Promise<void> {
    const projectRoot = this.projectRootDir;
    const serverDir = path.join(projectRoot, '.positronic');

    // Ensure .positronic directory exists
    await this.ensureServerDirectory(projectRoot, serverDir, force);

    // Sync environment variables to .dev.vars
    await this.syncEnvironmentVariables(projectRoot, serverDir);

    // Regenerate manifest based on actual project state
    await this.regenerateProjectManifest(projectRoot, serverDir);

    // Update wrangler config based on environment
    await this.updateWranglerConfiguration(projectRoot, serverDir);
  }

  private async ensureServerDirectory(
    projectRoot: string,
    serverDir: string,
    force?: boolean
  ): Promise<void> {
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
  }

  private async syncEnvironmentVariables(
    projectRoot: string,
    serverDir: string
  ): Promise<void> {
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
  }

  private async regenerateProjectManifest(
    projectRoot: string,
    serverDir: string
  ): Promise<void> {
    const srcDir = path.join(serverDir, 'src');
    await regenerateManifestFile(projectRoot, srcDir);
  }

  private async updateWranglerConfiguration(
    projectRoot: string,
    serverDir: string
  ): Promise<void> {
    const wranglerConfigPath = path.join(serverDir, 'wrangler.jsonc');
    if (!fs.existsSync(wranglerConfigPath)) {
      return;
    }

    // Parse environment variables
    const parsedEnv = this.parseEnvironmentFile(projectRoot);

    // Check R2 configuration mode
    const hasR2Credentials = this.hasCompleteR2Credentials(parsedEnv);

    // Update wrangler config if needed
    await this.applyWranglerConfigUpdates(
      wranglerConfigPath,
      parsedEnv,
      hasR2Credentials
    );
  }

  private parseEnvironmentFile(projectRoot: string): Record<string, string> {
    const rootEnvFilePath = path.join(projectRoot, '.env');
    if (!fs.existsSync(rootEnvFilePath)) {
      return {};
    }

    const rootEnvFileContent = fs.readFileSync(rootEnvFilePath);
    return dotenv.parse(rootEnvFileContent);
  }

  private hasCompleteR2Credentials(env: Record<string, string>): boolean {
    return Boolean(
      env.R2_ACCESS_KEY_ID?.trim() &&
        env.R2_SECRET_ACCESS_KEY?.trim() &&
        env.R2_ACCOUNT_ID?.trim() &&
        env.R2_BUCKET_NAME?.trim()
    );
  }

  private async applyWranglerConfigUpdates(
    configPath: string,
    env: Record<string, string>,
    hasR2Credentials: boolean
  ): Promise<void> {
    // Read and parse the wrangler config
    const wranglerContent = fs.readFileSync(configPath, 'utf-8');
    const wranglerConfig = JSON.parse(wranglerContent);
    let configChanged = false;

    if (hasR2Credentials) {
      configChanged = this.configureRemoteR2(wranglerConfig, env);
    } else {
      configChanged = this.configureLocalR2(wranglerConfig);
    }

    // Write back the updated configuration only if it changed
    if (configChanged) {
      const updatedContent = JSON.stringify(wranglerConfig, null, 2);
      fs.writeFileSync(configPath, updatedContent);
      console.log(
        hasR2Credentials
          ? '🔗 Configured for remote R2 bindings'
          : '🏠 Configured for local R2 bindings'
      );
    }
  }

  private configureRemoteR2(config: any, env: Record<string, string>): boolean {
    let changed = false;

    if (config.r2_buckets && config.r2_buckets[0]) {
      if (config.r2_buckets[0].bucket_name !== env.R2_BUCKET_NAME) {
        config.r2_buckets[0].bucket_name = env.R2_BUCKET_NAME;
        changed = true;
      }
      if (!config.r2_buckets[0].experimental_remote) {
        config.r2_buckets[0].experimental_remote = true;
        changed = true;
      }
    }

    // Also update the vars section
    if (config.vars && config.vars.R2_BUCKET_NAME !== env.R2_BUCKET_NAME) {
      config.vars.R2_BUCKET_NAME = env.R2_BUCKET_NAME;
      changed = true;
    }

    return changed;
  }

  private configureLocalR2(config: any): boolean {
    let changed = false;

    if (config.r2_buckets && config.r2_buckets[0]) {
      // Get project name from the wrangler config name (remove "positronic-dev-" prefix)
      const configName = config.name || 'local-project';
      const projectName =
        configName.replace(/^positronic-dev-/, '') || 'local-project';

      if (config.r2_buckets[0].experimental_remote) {
        delete config.r2_buckets[0].experimental_remote;
        changed = true;
      }
      if (config.r2_buckets[0].bucket_name !== projectName) {
        config.r2_buckets[0].bucket_name = projectName;
        changed = true;
      }

      // Also update the vars section
      if (config.vars && config.vars.R2_BUCKET_NAME !== projectName) {
        config.vars.R2_BUCKET_NAME = projectName;
        changed = true;
      }
    }

    return changed;
  }

  async start(port?: number): Promise<ServerHandle> {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Start wrangler dev server
    const wranglerArgs = ['dev', '--x-remote-bindings'];

    if (port) {
      wranglerArgs.push('--port', String(port));
    }

    const wranglerProcess = spawn('npx', ['wrangler', ...wranglerArgs], {
      cwd: serverDir,
      stdio: ['inherit', 'pipe', 'pipe'], // stdin inherit, stdout/stderr piped
      shell: true,
    });

    // Capture and forward stdout
    wranglerProcess.stdout?.on('data', (data) => {
      const message = data.toString();
      
      // Send to registered callbacks
      this.logCallbacks.forEach(cb => cb(message));
      
      // Always forward to console
      process.stdout.write(data);
    });

    // Capture and forward stderr
    wranglerProcess.stderr?.on('data', (data) => {
      const message = data.toString();
      
      // Parse for warnings vs errors
      if (message.includes('WARNING') || message.includes('⚠')) {
        this.warningCallbacks.forEach(cb => cb(message));
      } else {
        this.errorCallbacks.forEach(cb => cb(message));
      }
      
      // Always forward to console
      process.stderr.write(data);
    });

    wranglerProcess.on('error', (err) => {
      const errorMessage = `Failed to start Wrangler dev server: ${err.message}\n`;
      this.errorCallbacks.forEach(cb => cb(errorMessage));
      console.error('Failed to start Wrangler dev server:', err);
    });

    return new ProcessServerHandle(wranglerProcess, port);
  }

  async watch(
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    const projectRoot = this.projectRootDir;
    // Regenerate manifest when brain files change
    const serverDir = path.join(projectRoot, '.positronic');
    const srcDir = path.join(serverDir, 'src');

    console.log(`Brain file ${event}: ${path.relative(projectRoot, filePath)}`);
    await regenerateManifestFile(projectRoot, srcDir);
  }

  async deploy(): Promise<void> {
    const projectRoot = this.projectRootDir;
    const serverDir = path.join(projectRoot, '.positronic');

    // Ensure .positronic directory and manifest are up to date, but don't force regeneration
    await this.setup();

    // Load environment variables from .env file
    const envPath = path.join(projectRoot, '.env');

    // Check if .env file exists
    if (!fs.existsSync(envPath)) {
      throw new Error(
        'No .env file found.\n' +
          'Please create a .env file in your project root with your Cloudflare credentials.\n' +
          'See the template in your project for the required variables.'
      );
    }

    const envConfig = dotenv.parse(fs.readFileSync(envPath, 'utf8'));

    // Check for required Cloudflare credentials
    if (!envConfig.CLOUDFLARE_API_TOKEN || !envConfig.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error(
        'Missing required Cloudflare credentials.\n' +
          'Please add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to your .env file.\n' +
          'See .env file comments for instructions on obtaining these values.'
      );
    }

    console.log('🚀 Deploying to Cloudflare Workers (production)...');

    // Deploy to production using wrangler
    return new Promise<void>((resolve, reject) => {
      const wranglerProcess = spawn(
        'npx',
        ['wrangler', 'deploy', '--env', 'production'],
        {
          cwd: serverDir,
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: true,
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: envConfig.CLOUDFLARE_API_TOKEN,
            CLOUDFLARE_ACCOUNT_ID: envConfig.CLOUDFLARE_ACCOUNT_ID,
          },
        }
      );

      // Capture and forward stdout
      wranglerProcess.stdout?.on('data', (data) => {
        const message = data.toString();
        this.logCallbacks.forEach(cb => cb(message));
        process.stdout.write(data);
      });

      // Capture and forward stderr
      wranglerProcess.stderr?.on('data', (data) => {
        const message = data.toString();
        if (message.includes('WARNING') || message.includes('⚠')) {
          this.warningCallbacks.forEach(cb => cb(message));
        } else {
          this.errorCallbacks.forEach(cb => cb(message));
        }
        process.stderr.write(data);
      });

      wranglerProcess.on('error', (err) => {
        const errorMessage = `Failed to start Wrangler deploy: ${err.message}\n`;
        this.errorCallbacks.forEach(cb => cb(errorMessage));
        console.error('Failed to start Wrangler deploy:', err);
        reject(err);
      });

      wranglerProcess.on('exit', (code) => {
        if (code === 0) {
          const successMessage = '✅ Deployment complete!\n';
          this.logCallbacks.forEach(cb => cb(successMessage));
          console.log('✅ Deployment complete!');
          resolve();
        } else {
          reject(new Error(`Wrangler deploy exited with code ${code}`));
        }
      });
    });
  }

  onLog(callback: (message: string) => void): void {
    this.logCallbacks.push(callback);
  }

  onError(callback: (message: string) => void): void {
    this.errorCallbacks.push(callback);
  }

  onWarning(callback: (message: string) => void): void {
    this.warningCallbacks.push(callback);
  }
}
