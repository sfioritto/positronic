const fs = require('fs/promises');
const path = require('path');

/**
 * Caz template configuration.
 * @type {import('caz').Template}
 */
module.exports = {
  name: 'positronic-cloudflare-dev-server',
  version: '0.0.1',
  source: 'template',
  prompts: [
    {
      name: 'projectName',
      type: 'text',
      message: 'Project name (used for package.json and wrangler.jsonc)'
      // Default could be derived from parent directory name in setup?
    },
    // userCoreVersion prompt removed, will be read from parent package.json
  ],
  // No install needed for the template package itself usually,
  // but the *generated* project will need install.
  // Caz handles the install in the destination dir if package.json exists.

  /**
   * Reads the parent project's package.json to determine dependency versions.
   */
  setup: async ctx => {
    try {
      console.log('Setting up template...');
      const parentPackageJsonPath = path.join(ctx.dest, '..', 'package.json');
      const userPackageJsonContent = await fs.readFile(parentPackageJsonPath, 'utf-8');
      const userPackageJson = JSON.parse(userPackageJsonContent);
      // Store versions needed in answers or directly on config/ctx if preferred
      ctx.answers.coreVersion = userPackageJson.dependencies?.['@positronic/core'] || 'latest';
      ctx.answers.cloudflareVersion = userPackageJson.dependencies?.['@positronic/cloudflare'] || 'latest';
      // If projectName wasn't provided via CLI/override, use parent dir name
      ctx.answers.projectName = ctx.answers.projectName || path.basename(path.resolve(ctx.dest, '..'));

    } catch (error) {
      console.warn(`Warning: Could not read parent project's package.json at ${path.join(ctx.dest, '..')}. Using latest for Positronic dependencies.`);
      ctx.answers.coreVersion = 'latest';
      ctx.answers.cloudflareVersion = 'latest';
      ctx.answers.projectName = ctx.answers.projectName || 'positronic-project'; // Fallback project name
    }
  },

  /**
   * Modifies the template package.json with dynamic dependencies
   * and generates the _manifest.ts file.
   */
  prepare: async ctx => {
    console.log('Preparing template...');
    // --- 1. Modify package.json ---
    const packageJsonFile = ctx.files.find(f => f.path === 'package.json');
    if (packageJsonFile) {
      const packageJson = JSON.parse(packageJsonFile.contents.toString());
      packageJson.dependencies = packageJson.dependencies || {};

      // Set versions from context first (might be 'latest' or from parent package.json)
      packageJson.dependencies['@positronic/core'] = ctx.answers.coreVersion;
      packageJson.dependencies['@positronic/cloudflare'] = ctx.answers.cloudflareVersion;

      // Check for local development path override
      const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
      if (devRootPath) {
        console.log(`Found POSITRONIC_PACKAGES_DEV_PATH: ${devRootPath}. Using local file paths for @positronic/* dependencies.`);
        for (const dependency of Object.keys(packageJson.dependencies)) {
          if (dependency.startsWith('@positronic/')) {
            const packageName = dependency.replace('@positronic/', '');
            // Construct the absolute path to the local package
            const localPackagePath = path.resolve(devRootPath, 'packages', packageName);
            // Use file: protocol for local dependency
            packageJson.dependencies[dependency] = `file:${localPackagePath}`;
            console.log(`  - Mapping ${dependency} to ${packageJson.dependencies[dependency]}`);
          }
        }
      } else {
        console.log('POSITRONIC_PACKAGES_DEV_PATH not set. Using versions from context/npm for @positronic/* dependencies.');
      }

      packageJsonFile.contents = Buffer.from(JSON.stringify(packageJson, null, 2));
    } else {
      console.warn('Warning: Could not find package.json in template files.');
    }

    // --- 2. Generate _manifest.ts ---
    const brainsDir = path.join(ctx.dest, '..', 'brains'); // Path relative to the final destination (.positronic)
    let importStatements = `import type { Workflow } from '@positronic/core';\n`;
    let manifestEntries = '';
    try {
      const files = await fs.readdir(brainsDir);
      const brainFiles = files.filter(file => file.endsWith('.ts') && !file.startsWith('_'));

      for (const file of brainFiles) {
        const brainName = path.basename(file, '.ts');
        // Path relative from within the generated .positronic/src directory
        const importPath = `../../brains/${brainName}.js`;
        const importAlias = `brain_${brainName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        importStatements += `import * as ${importAlias} from '${importPath}';\n`;
        manifestEntries += `  ${JSON.stringify(brainName)}: ${importAlias}.default as Workflow,\n`;
      }
    } catch (error) {
      console.warn(`Warning: 'brains' directory not found at ${brainsDir}. Manifest will be empty.`);
    }

    const manifestContent = `// This file is generated automatically. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Workflow> = {\n${manifestEntries}};
`;

    // Add the generated manifest to the list of files to be emitted
    ctx.files.push({
      path: 'src/_manifest.ts', // Path within the template structure
      contents: Buffer.from(manifestContent)
    });

  },

  complete: ctx => {
    console.log(`Initialized Cloudflare dev server environment in ${ctx.dest}`); // ctx.dest is .positronic
    console.log(`Make sure to run 'npm install' in '${ctx.dest}' if it wasn't run automatically.`);
  }
};