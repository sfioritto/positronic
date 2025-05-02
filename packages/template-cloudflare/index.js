const fs = require('fs/promises');
const path = require('path');

module.exports = {
  name: 'positronic-cloudflare',
  version: '0.0.1',
  source: 'template',
  prompts: [],
  /**
   * Reads the parent project's package.json to determine dependency versions
   * and the project name.
   */
  setup: async ctx => {
    try {
      const parentPackageJsonPath = path.join(ctx.dest, '..', 'package.json');
      const userPackageJsonContent = await fs.readFile(parentPackageJsonPath, 'utf-8');
      const userPackageJson = JSON.parse(userPackageJsonContent);

      if (!userPackageJson.name) {
        throw new Error('Parent project package.json does not contain a "name" field.');
      }

      const projectName = userPackageJson.name;
      ctx.answers.projectName = projectName;
      ctx.answers.coreVersion = userPackageJson.dependencies?.['@positronic/core'] || 'latest';
      ctx.answers.cloudflareVersion = userPackageJson.dependencies?.['@positronic/cloudflare'] || 'latest';

    } catch (error) {
      console.warn(`Warning: Could not read or parse parent project's package.json at ${path.join(ctx.dest, '..')}. Error: ${error.message}. Using default project name and latest for Positronic dependencies.`);
      ctx.answers.projectName = 'default-positronic-project';
      ctx.answers.coreVersion = 'latest';
      ctx.answers.cloudflareVersion = 'latest';
    }
  },

  /**
   * Modifies the template package.json with dynamic dependencies
   * and generates the _manifest.ts file.
   */
  prepare: async ctx => {
    // --- 1. Modify package.json ---
    const packageJsonFile = ctx.files.find(f => f.path === 'package.json');
    if (!packageJsonFile) {
      throw new Error('package.json file not found in template files.');
    }

    const packageJson = JSON.parse(packageJsonFile.contents.toString());
    packageJson.dependencies = packageJson.dependencies;

    if (!packageJson.dependencies) {
      throw new Error('package.json does not contain a "dependencies" field.');
    }

    if (!packageJson.dependencies['@positronic/core'] || !packageJson.dependencies['@positronic/cloudflare']) {
      throw new Error('package.json does not contain @positronic/core or @positronic/cloudflare dependencies.');
    }
    packageJson.dependencies['@positronic/core'] = ctx.answers.coreVersion;
    packageJson.dependencies['@positronic/cloudflare'] = ctx.answers.cloudflareVersion;

    // Check for local development path override
    // This allows for developers of @positronic/core and @positronic/cloudflare to test changes to the packages
    // by setting the POSITRONIC_PACKAGES_DEV_PATH environment variable.
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

      packageJsonFile.contents = Buffer.from(JSON.stringify(packageJson, null, 2));
    }

    // --- 2. Generate _manifest.ts ---
    const brainsDir = path.join(ctx.dest, '..', 'brains');
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
};