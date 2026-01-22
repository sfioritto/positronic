import * as path from 'path';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import type { Dirent } from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess, execSync } from 'child_process';
import * as dotenv from 'dotenv';
import caz from 'caz';
import { createRequire } from 'module';
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
    claudemd?: boolean;
  } = { name: projectName };

  let templateSourcePath: string;

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
      templateSourcePath = path.resolve(
        devPath,
        'packages',
        'template-new-project'
      );
    } else {
      // Resolve the installed template package location
      const require = createRequire(import.meta.url);
      const templatePackageJsonPath = require.resolve('@positronic/template-new-project/package.json');
      templateSourcePath = path.dirname(templatePackageJsonPath);
    }

    // Always copy to a temporary directory to avoid CAZ modifying our source
    // CAZ only supports local paths, GitHub repos, or ZIP URLs - not npm package names
    // Additionally, CAZ runs 'npm install --production' in the template directory,
    // which would modify our installed node_modules if we passed the path directly
    const copiedNewProjectPkg = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-newproj-')
    );
    fs.cpSync(templateSourcePath, copiedNewProjectPkg, {
      recursive: true,
    });
    newProjectTemplatePath = copiedNewProjectPkg;
    
    // Set CAZ options for cloudflare backend
    cazOptions = {
      name: projectName,
      backend: 'cloudflare',
      install: true,
      pm: 'npm',
      claudemd: false, // Don't prompt for CLAUDE.md when regenerating .positronic directory
    };

    await caz.default(newProjectTemplatePath, projectDir, {
      ...cazOptions,
      force: false,
    });

    await onSuccess?.();
  } finally {
    // Clean up the temporary copied new project package
    fs.rmSync(newProjectTemplatePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
    });
  }
}

export async function discoverBrains(
  brainsDir: string
): Promise<{ name: string; relativePath: string }[]> {
  const entries = await fsPromises
    .readdir(brainsDir, { withFileTypes: true })
    .catch(() => [] as Dirent[]);

  const brains = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('_'))
      .map(async (entry) => {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
          return { name: entry.name.replace(/\.ts$/, ''), relativePath: entry.name };
        }
        const indexPath = path.join(brainsDir, entry.name, 'index.ts');
        const hasIndex = await fsPromises.access(indexPath).then(() => true, () => false);
        return hasIndex ? { name: entry.name, relativePath: `${entry.name}/index.ts` } : null;
      })
  );

  return brains.filter((b) => b !== null);
}

export async function discoverWebhooks(
  webhooksDir: string
): Promise<{ name: string; relativePath: string }[]> {
  const entries = await fsPromises
    .readdir(webhooksDir, { withFileTypes: true })
    .catch(() => [] as Dirent[]);

  const webhooks = entries
    .filter((e) => !e.name.startsWith('_') && e.isFile() && e.name.endsWith('.ts'))
    .map((entry) => ({
      name: entry.name.replace(/\.ts$/, ''),
      relativePath: entry.name,
    }));

  return webhooks;
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

  const brains = await discoverBrains(brainsDir);

  for (const brain of brains) {
    const importPath = `../../brains/${brain.relativePath.replace(/\.ts$/, '.js')}`;
    const importAlias = `brain_${brain.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    importStatements += `import * as ${importAlias} from '${importPath}';\n`;

    manifestEntries += `  ${JSON.stringify(brain.name)}: {\n`;
    manifestEntries += `    filename: ${JSON.stringify(brain.name)},\n`;
    manifestEntries += `    path: ${JSON.stringify(`brains/${brain.relativePath}`)},\n`;
    manifestEntries += `    brain: ${importAlias}.default as Brain,\n`;
    manifestEntries += `  },\n`;
  }

  const manifestContent = `// This file is generated automatically. Do not edit directly.
${importStatements}
import type { BrainMetadata } from '@positronic/cloudflare';

export const manifest: Record<string, BrainMetadata> = {
${manifestEntries}};
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

async function regenerateWebhookManifestFile(
  projectRootPath: string,
  targetSrcDir: string
) {
  const webhooksDir = path.join(projectRootPath, 'webhooks');
  const manifestPath = path.join(targetSrcDir, '_webhookManifest.ts');

  const webhooks = await discoverWebhooks(webhooksDir);

  let importStatements = '';
  let manifestEntries = '';

  for (const webhook of webhooks) {
    const importPath = `../../webhooks/${webhook.relativePath.replace(/\.ts$/, '.js')}`;
    const importAlias = `webhook_${webhook.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    importStatements += `import ${importAlias} from '${importPath}';\n`;

    manifestEntries += `  ${JSON.stringify(webhook.name)}: ${importAlias},\n`;
  }

  const manifestContent = `// This file is generated automatically. Do not edit directly.
${importStatements}
export const webhookManifest: Record<string, any> = {
${manifestEntries}};
`;

  await fsPromises.mkdir(targetSrcDir, { recursive: true });
  await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');
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

    // Build and upload component bundle
    await this.buildAndUploadBundle(projectRoot);
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

        // Read the actual project name from the config file
        const configPath = path.join(projectRoot, 'positronic.config.json');
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        const projectName = config.projectName;

        if (!projectName) {
          throw new Error('Project name not found in positronic.config.json');
        }

        await generateProject(projectName, tempDir, async () => {
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
    await regenerateWebhookManifestFile(projectRoot, srcDir);
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
      if (!config.r2_buckets[0].remote) {
        config.r2_buckets[0].remote = true;
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

      if (config.r2_buckets[0].remote) {
        delete config.r2_buckets[0].remote;
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

  /**
   * Build the component bundle and upload it to local R2.
   * Uses esbuild to bundle components/bundle.ts and uploads to R2 for serving.
   */
  private async buildAndUploadBundle(projectRoot: string): Promise<void> {
    const bundleEntryPath = path.join(projectRoot, 'components', 'bundle.ts');
    const distDir = path.join(projectRoot, 'dist');
    const bundleOutputPath = path.join(distDir, 'components.js');

    // Check if components directory exists
    const componentsDir = path.join(projectRoot, 'components');
    const hasComponents = await fsPromises
      .access(componentsDir)
      .then(() => true)
      .catch(() => false);

    if (!hasComponents) {
      console.log('📦 No components/ directory found, skipping bundle build');
      return;
    }

    // Check if bundle.ts exists
    const hasBundleEntry = await fsPromises
      .access(bundleEntryPath)
      .then(() => true)
      .catch(() => false);

    if (!hasBundleEntry) {
      console.log('📦 No components/bundle.ts found, skipping bundle build');
      return;
    }

    try {
      console.log('📦 Building component bundle...');

      // Ensure dist directory exists
      await fsPromises.mkdir(distDir, { recursive: true });

      // Run esbuild to build the bundle
      execSync(`npx esbuild "${bundleEntryPath}" --bundle --external:react --external:react-dom --format=iife --outfile="${bundleOutputPath}" --jsx=transform --jsx-factory=React.createElement --jsx-fragment=React.Fragment`, {
        cwd: projectRoot,
        stdio: 'inherit',
      });

      // Read the built bundle
      const bundleContent = await fsPromises.readFile(bundleOutputPath, 'utf-8');

      // Upload to local R2 using wrangler
      const serverDir = path.join(projectRoot, '.positronic');

      // Get bucket name from wrangler config
      const wranglerConfigPath = path.join(serverDir, 'wrangler.jsonc');
      const wranglerConfig = JSON.parse(fs.readFileSync(wranglerConfigPath, 'utf-8'));
      const bucketName = wranglerConfig.r2_buckets?.[0]?.bucket_name;

      if (!bucketName) {
        console.warn('⚠️  Warning: No R2 bucket configured, skipping bundle upload');
        return;
      }

      const r2Key = 'bundle/components.js';
      const r2Path = `${bucketName}/${r2Key}`;

      // Write bundle to a temp file for wrangler r2 object put
      const tempBundlePath = path.join(os.tmpdir(), `positronic-bundle-${Date.now()}.js`);
      await fsPromises.writeFile(tempBundlePath, bundleContent);

      try {
        execSync(`npx wrangler r2 object put "${r2Path}" --file="${tempBundlePath}" --local`, {
          cwd: serverDir,
          stdio: 'pipe',
        });
        console.log('✅ Component bundle built and uploaded');
      } finally {
        // Clean up temp file
        await fsPromises.unlink(tempBundlePath).catch(() => {});
      }
    } catch (error) {
      console.warn(
        '⚠️  Warning: Failed to build component bundle:',
        error instanceof Error ? error.message : error
      );
      console.warn('   Pages may not render correctly without the bundle.');
    }
  }

  async start(port?: number): Promise<ServerHandle> {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Start wrangler dev server
    const wranglerArgs = ['dev'];

    // Always specify a port - use 8787 as default if not provided
    const serverPort = port || 8787;
    wranglerArgs.push('--port', String(serverPort));

    const wranglerProcess = spawn('npx', ['wrangler', ...wranglerArgs], {
      cwd: serverDir,
      // Don't inherit stdin - this prevents wrangler from:
      // 1. Setting terminal to raw mode (which breaks Ctrl-A, Ctrl-E after exit)
      // 2. Receiving SIGINT directly (we handle Ctrl-C in the parent process)
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture and forward stdout
    wranglerProcess.stdout?.on('data', (data) => {
      const message = data.toString();

      // Send to registered callbacks
      this.logCallbacks.forEach((cb) => cb(message));

      // Always forward to console
      process.stdout.write(data);
    });

    // Capture and forward stderr
    wranglerProcess.stderr?.on('data', (data) => {
      const message = data.toString();

      // Parse for warnings vs errors
      if (message.includes('WARNING') || message.includes('⚠')) {
        this.warningCallbacks.forEach((cb) => cb(message));
      } else {
        this.errorCallbacks.forEach((cb) => cb(message));
      }

      // Always forward to console
      process.stderr.write(data);
    });

    wranglerProcess.on('error', (err) => {
      const errorMessage = `Failed to start Wrangler dev server: ${err.message}\n`;
      this.errorCallbacks.forEach((cb) => cb(errorMessage));
      console.error('Failed to start Wrangler dev server:', err);
    });

    return new ProcessServerHandle(wranglerProcess, serverPort);
  }

  async watch(
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    const projectRoot = this.projectRootDir;
    const serverDir = path.join(projectRoot, '.positronic');
    const srcDir = path.join(serverDir, 'src');
    const relativePath = path.relative(projectRoot, filePath);

    // Determine if this is a brain, webhook, or component file change
    if (relativePath.startsWith('brains/') || relativePath.startsWith('brains\\')) {
      console.log(`Brain file ${event}: ${relativePath}`);
      await regenerateManifestFile(projectRoot, srcDir);
    } else if (relativePath.startsWith('webhooks/') || relativePath.startsWith('webhooks\\')) {
      console.log(`Webhook file ${event}: ${relativePath}`);
      await regenerateWebhookManifestFile(projectRoot, srcDir);
    } else if (relativePath.startsWith('components/') || relativePath.startsWith('components\\')) {
      console.log(`Component file ${event}: ${relativePath}`);
      await this.buildAndUploadBundle(projectRoot);
    }
  }

  private async ensureR2BucketExists(bucketName: string): Promise<void> {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      throw new Error(
        'Missing Cloudflare credentials for R2 bucket management.\n' +
          'Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.'
      );
    }

    const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };

    // Check if bucket exists using Cloudflare API
    const listResponse = await fetch(apiBase, { headers });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(
        `Failed to list R2 buckets: ${listResponse.status} ${listResponse.statusText}\n${errorText}`
      );
    }

    const listData = (await listResponse.json()) as {
      success: boolean;
      result: { buckets: Array<{ name: string }> };
    };

    const existingBuckets = listData.result.buckets.map((b) => b.name);

    if (existingBuckets.includes(bucketName)) {
      console.log(`📦 R2 bucket '${bucketName}' already exists`);
      return;
    }

    // Create the bucket using Cloudflare API
    console.log(`📦 Creating R2 bucket '${bucketName}'...`);

    const createResponse = await fetch(apiBase, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: bucketName }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(
        `Failed to create R2 bucket: ${createResponse.status} ${createResponse.statusText}\n${errorText}`
      );
    }

    console.log(`✅ R2 bucket '${bucketName}' created successfully`);
  }

  async deploy(): Promise<void> {
    const projectRoot = this.projectRootDir;
    const serverDir = path.join(projectRoot, '.positronic');

    // Ensure .positronic directory and manifest are up to date, but don't force regeneration
    await this.setup();

    // Check for required Cloudflare credentials in environment variables
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      throw new Error(
        'Missing required Cloudflare credentials.\n' +
          'Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.\n' +
          'For example:\n' +
          '  export CLOUDFLARE_API_TOKEN=your-api-token\n' +
          '  export CLOUDFLARE_ACCOUNT_ID=your-account-id'
      );
    }

    // Get project name from config (used as R2 bucket name)
    const configPath = path.join(projectRoot, 'positronic.config.json');
    const configContent = await fsPromises.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    const bucketName = config.projectName;

    if (!bucketName) {
      throw new Error('Project name not found in positronic.config.json');
    }

    // Ensure R2 bucket exists before deploying
    await this.ensureR2BucketExists(bucketName);

    console.log('🚀 Deploying to Cloudflare Workers (production)...');

    // Deploy to production using wrangler
    return new Promise<void>((resolve, reject) => {
      const wranglerProcess = spawn(
        'npx',
        ['wrangler', 'deploy', '--env', 'production'],
        {
          cwd: serverDir,
          stdio: ['inherit', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
            CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
          },
        }
      );

      // Capture and forward stdout
      wranglerProcess.stdout?.on('data', (data) => {
        const message = data.toString();
        this.logCallbacks.forEach((cb) => cb(message));
        process.stdout.write(data);
      });

      // Capture and forward stderr
      wranglerProcess.stderr?.on('data', (data) => {
        const message = data.toString();
        if (message.includes('WARNING') || message.includes('⚠')) {
          this.warningCallbacks.forEach((cb) => cb(message));
        } else {
          this.errorCallbacks.forEach((cb) => cb(message));
        }
        process.stderr.write(data);
      });

      wranglerProcess.on('error', (err) => {
        const errorMessage = `Failed to start Wrangler deploy: ${err.message}\n`;
        this.errorCallbacks.forEach((cb) => cb(errorMessage));
        console.error('Failed to start Wrangler deploy:', err);
        reject(err);
      });

      wranglerProcess.on('exit', async (code) => {
        if (code === 0) {
          console.log('✅ Deployment complete!');

          // Set up secrets for the secrets management API
          console.log('🔐 Configuring secrets management...');
          try {
            await this.setupSecretsManagement(bucketName);
            const successMessage = '✅ Deployment and secrets configuration complete!\n';
            this.logCallbacks.forEach((cb) => cb(successMessage));
            console.log('✅ Secrets management configured!');
            resolve();
          } catch (secretsError) {
            // Warn but don't fail deployment if secrets setup fails
            console.warn('⚠️  Warning: Could not configure secrets management:', secretsError);
            console.warn('   You can manually set these secrets later with:');
            console.warn('   wrangler secret put CLOUDFLARE_API_TOKEN --env production');
            console.warn('   wrangler secret put CLOUDFLARE_ACCOUNT_ID --env production');
            console.warn('   wrangler secret put CF_SCRIPT_NAME --env production');
            resolve();
          }
        } else {
          reject(new Error(`Wrangler deploy exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Set up secrets required for the secrets management API.
   * This allows the deployed worker to manage its own secrets via HTTP API.
   */
  private async setupSecretsManagement(projectName: string): Promise<void> {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN!;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;

    const secrets = [
      { name: 'CLOUDFLARE_API_TOKEN', value: apiToken },
      { name: 'CLOUDFLARE_ACCOUNT_ID', value: accountId },
      { name: 'CF_SCRIPT_NAME', value: projectName },
    ];

    for (const secret of secrets) {
      await this.setWorkerSecret(accountId, projectName, secret.name, secret.value, apiToken);
    }
  }

  /**
   * Set a secret on a Cloudflare Worker using the Cloudflare API.
   */
  private async setWorkerSecret(
    accountId: string,
    scriptName: string,
    secretName: string,
    secretValue: string,
    apiToken: string
  ): Promise<void> {
    // Cloudflare API endpoint - secret name goes in the body, not the URL
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: secretName,
        text: secretValue,
        type: 'secret_text',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to set secret ${secretName}: ${error}`);
    }
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

  async listSecrets(): Promise<
    Array<{ name: string; createdAt?: Date; updatedAt?: Date }>
  > {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Get auth from environment variables
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      throw new Error(
        'Missing Cloudflare credentials. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.'
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['wrangler', 'secret', 'list'], {
        cwd: serverDir,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        },
        stdio: 'inherit', // Pass through all output directly to the terminal
      });

      child.on('close', (code) => {
        if (code !== 0) {
          // Don't wrap the error - backend CLI already printed it
          reject(new Error(''));
        } else {
          // Return empty array - output was already printed
          resolve([]);
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async setSecret(name: string, value: string): Promise<void> {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Get auth from environment variables
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      throw new Error(
        'Missing Cloudflare credentials. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.'
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
        cwd: serverDir,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        },
        stdio: ['pipe', 'inherit', 'inherit'], // stdin pipe, stdout/stderr inherit
      });

      child.stdin.write(value);
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          // Don't wrap the error - backend CLI already printed it
          reject(new Error(''));
        } else {
          resolve();
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async deleteSecret(name: string): Promise<boolean> {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Get auth from environment variables
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      throw new Error(
        'Missing Cloudflare credentials. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.'
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['wrangler', 'secret', 'delete', name], {
        cwd: serverDir,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        },
        stdio: 'inherit', // Pass through all output directly to the terminal
      });

      child.on('close', (code) => {
        if (code !== 0) {
          // Don't wrap the error - backend CLI already printed it
          reject(new Error(''));
        } else {
          resolve(true);
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async bulkSecrets(filePath: string): Promise<void> {
    const serverDir = path.join(this.projectRootDir, '.positronic');

    // Check auth credentials
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !process.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      throw new Error(
        'Missing Cloudflare credentials. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.'
      );
    }

    // Read and parse the .env file
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const envContent = fs.readFileSync(filePath, 'utf8');
    const secrets = dotenv.parse(envContent);

    if (Object.keys(secrets).length === 0) {
      throw new Error('No secrets found in the .env file');
    }

    // Convert to JSON format that wrangler expects
    const jsonContent = JSON.stringify(secrets);

    return new Promise((resolve, reject) => {
      // Use wrangler secret:bulk command
      const child = spawn('npx', ['wrangler', 'secret:bulk'], {
        cwd: serverDir,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        },
        stdio: ['pipe', 'inherit', 'inherit'], // stdin pipe, stdout/stderr inherit
      });

      // Write JSON to stdin
      child.stdin.write(jsonContent);
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          // Don't wrap the error - backend CLI already printed it
          reject(new Error(''));
        } else {
          resolve();
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
