const { name, version } = require('./package.json')
const path = require('path')
const fs = require('fs/promises')
const { existsSync } = require('fs')

async function generateManifest(projectRootPath, targetSrcDir) {
  const runnerPath = path.join(projectRootPath, 'runner.ts');
  const brainsDir = path.join(projectRootPath, 'brains');
  const manifestPath = path.join(targetSrcDir, '_manifest.ts');

  let importStatements = `import type { Workflow } from '@positronic/core';\n`;
  let manifestEntries = '';

  const brainsDirExists = await fs.access(brainsDir).then(() => true).catch(() => false);
  if (brainsDirExists) {
    const files = await fs.readdir(brainsDir);
    const brainFiles = files.filter(file => file.endsWith('.ts') && !file.startsWith('_'));

    for (const file of brainFiles) {
      const brainName = path.basename(file, '.ts');
      const importPath = `../../brains/${brainName}.js`;
      const importAlias = `brain_${brainName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

      importStatements += `import * as ${importAlias} from '${importPath}';\n`;
      manifestEntries += `  ${JSON.stringify(brainName)}: ${importAlias}.default as Workflow,\n`;
    }
  }

  const manifestContent = `// This file is generated automatically. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Workflow> = {\n${manifestEntries}};
`;

  const runnerContent = await fs.readFile(runnerPath, 'utf-8');
  await fs.mkdir(targetSrcDir, { recursive: true });
  await fs.writeFile(manifestPath, manifestContent, 'utf-8');
  await fs.writeFile(path.join(targetSrcDir, 'runner.ts'), runnerContent, 'utf-8');

}

// Convert filename to camelCase (e.g., "my-file.txt" -> "myFileTxt")
function toCamelCase(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '') // Remove extension
    .replace(/[-_\s]+(.)?/g, (_, char) => char ? char.toUpperCase() : ''); // Convert to camelCase
}

// Determine file type based on extension
function getResourceType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const textExtensions = ['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.csv', '.html', '.css', '.js', '.ts'];
  return textExtensions.includes(ext) ? 'text' : 'binary';
}

async function generateResourceManifest(projectRootPath) {
  const resourcesDir = path.join(projectRootPath, 'resources');
  const manifestPath = path.join(projectRootPath, '_resource-manifest.js');

  // Check if resources directory exists
  const resourcesDirExists = await fs.access(resourcesDir).then(() => true).catch(() => false);
  if (!resourcesDirExists) {
    // Create empty manifest if no resources directory
    const emptyManifest = `// This file is generated automatically. Do not edit directly.
// @ts-check

/** @type {import('@positronic/core').ResourceManifest} */
export const resourceManifest = {};
`;
    await fs.writeFile(manifestPath, emptyManifest, 'utf-8');
    return;
  }

  // Recursively scan directory
  async function scanDir(dir, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result = {};

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const resourcePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subResult = await scanDir(fullPath, resourcePath);
        if (Object.keys(subResult).length > 0) {
          result[toCamelCase(entry.name)] = subResult;
        }
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        // Add file to manifest with path and key
        const key = toCamelCase(entry.name);
        result[key] = {
          type: getResourceType(entry.name),
          path: fullPath,
          key: resourcePath // R2 object key (e.g., "example.txt" or "images/logo.png")
        };
      }
    }

    return result;
  }

  // Scan the resources directory
  const manifest = await scanDir(resourcesDir);

  // Generate TypeScript content
  const manifestContent = `// This file is generated automatically. Do not edit directly.
// @ts-check

/** @type {import('@positronic/core').ResourceManifest} */
export const resourceManifest = ${JSON.stringify(manifest, null, 2)};
`;

  await fs.writeFile(manifestPath, manifestContent, 'utf-8');
}

module.exports = {
  name,
  version,
  generateManifest,
  generateResourceManifest,
  prompts: [
    {
      name: 'name',
      type: 'text',
      message: 'Project name',
      initial: 'my-positronic-project'
    },
    {
      name: 'backend',
      type: 'select',
      message: 'Select your deployment backend',
      hint: ' ',
      choices: [
        { title: 'Cloudflare', value: 'cloudflare' },
        { title: 'AWS Lambda', value: 'aws', disabled: true },
        { title: 'Azure Functions', value: 'azure', disabled: true },
        { title: 'Google Cloud Functions', value: 'gcp', disabled: true },
        { title: 'Fly.io', value: 'fly', disabled: true },
        { title: 'None (Core only)', value: 'none' }
      ],
      initial: 0
    },
    {
      name: 'install',
      type: 'confirm',
      message: 'Install dependencies',
      initial: true
    },
    {
      name: 'pm',
      type: prev => prev ? 'select' : null,
      message: 'Package manager',
      hint: ' ',
      choices: [
        { title: 'npm', value: 'npm' },
        { title: 'pnpm', value: 'pnpm' },
        { title: 'yarn', value: 'yarn' }
      ]
    }
  ],
  setup: async ctx => {
    const devRootPath = process.env.POSITRONIC_LOCAL_PATH;
    let coreVersion = 'latest';
    let cloudflareVersion = 'latest';
    let clientVercelVersion = 'latest';

    if (devRootPath) {
      console.log(`Found POSITRONIC_LOCAL_PATH: ${devRootPath}. Using local file path for @positronic/core.`);
      const corePath = path.resolve(devRootPath, 'packages', 'core');
      coreVersion = `file:${corePath}`;
      console.log(`  - Mapping @positronic/core to ${coreVersion}`);
      console.log(`  - Mapping @positronic/cloudflare to ${cloudflareVersion}`);

      const cloudflarePath = path.resolve(devRootPath, 'packages', 'cloudflare');
      if (existsSync(cloudflarePath)) {
        cloudflareVersion = `file:${cloudflarePath}`;
      }

      const clientVercelPath = path.resolve(devRootPath, 'packages', 'client-vercel');
      if (existsSync(clientVercelPath)) {
        clientVercelVersion = `file:${clientVercelPath}`;
      }
    }

    ctx.answers.positronicCoreVersion = coreVersion;
    if (ctx.answers.backend === 'cloudflare') {
      ctx.answers.positronicCloudflareVersion = cloudflareVersion;
    }

    ctx.answers.positronicClientVercelVersion = clientVercelVersion;

    if (ctx.answers.install) {
      const pm = ctx.answers.pm;
      if (!pm) {
        ctx.config.install = 'npm';
        ctx.answers.pm = 'npm';
      } else {
        ctx.config.install = pm;
      }
    } else {
      ctx.config.install = false;
    }

    ctx.answers.projectName = ctx.answers.name;
  },
  prepare: async ctx => {
    // Find our specially named gitignore file in the list of files to be processed
    const gitignoreFile = ctx.files.find(file => file.path === '_gitignore');
    if (gitignoreFile) {
      // Change its path to '.gitignore' so it's correctly named in the generated project
      gitignoreFile.path = '.gitignore';
    }
  }
}