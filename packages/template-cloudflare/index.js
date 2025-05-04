const fs = require('fs/promises');
const path = require('path');

// --- Manifest Generation Logic ---
async function generateManifest(projectRootPath, targetSrcDir) {
  const brainsDir = path.join(projectRootPath, 'brains');
  const manifestPath = path.join(targetSrcDir, '_manifest.ts');

  let importStatements = `import type { Workflow } from '@positronic/core';\n`;
  let manifestEntries = '';

  try {
    // Ensure brains directory exists before trying to read it
    try {
      await fs.access(brainsDir);
    } catch (e) {
      console.warn(`Warning: 'brains' directory not found at ${brainsDir}. Manifest will be empty.`);
      // Fall through to write empty manifest
    }

    // Proceed only if brainsDir exists
    if (await fs.access(brainsDir).then(() => true).catch(() => false)) {
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
    }

  } catch (error) {
    // Log error during reading/processing brains, but still attempt to write the manifest
    console.error(`Error processing brains directory at ${brainsDir}: ${error.message}. Manifest might be incomplete.`);
  }

  const manifestContent = `// This file is generated automatically. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Workflow> = {\n${manifestEntries}};
`;

  try {
    // Ensure target directory exists before writing
    await fs.mkdir(targetSrcDir, { recursive: true });
    await fs.writeFile(manifestPath, manifestContent, 'utf-8');
    // console.log(`Manifest generated at ${manifestPath}`); // Optional: for debugging
  } catch (writeError) {
    console.error(`Error writing manifest file at ${manifestPath}: ${writeError.message}`);
    throw writeError; // Re-throw write error as it's critical
  }
}

// --- Caz Template Definition ---
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
    const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
    let coreVersion = 'latest'; // Default
    let cloudflareVersion = 'latest'; // Default
    let projectName = 'default-positronic-project'; // Default

    if (devRootPath) {
      console.log(`Found POSITRONIC_PACKAGES_DEV_PATH: ${devRootPath}. Using local file paths for @positronic/* dependencies.`);
      // Construct absolute paths for local dependencies
      const corePath = path.resolve(devRootPath, 'packages', 'core');
      const cloudflarePath = path.resolve(devRootPath, 'packages', 'cloudflare');
      coreVersion = `file:${corePath}`;
      cloudflareVersion = `file:${cloudflarePath}`;
      console.log(`  - Mapping @positronic/core to ${coreVersion}`);
      console.log(`  - Mapping @positronic/cloudflare to ${cloudflareVersion}`);

      // Still try to get project name from parent package.json
      try {
        const parentPackageJsonPath = path.join(ctx.dest, '..', 'package.json');
        const userPackageJsonContent = await fs.readFile(parentPackageJsonPath, 'utf-8');
        const userPackageJson = JSON.parse(userPackageJsonContent);
        if (userPackageJson.name) {
          projectName = userPackageJson.name;
        } else {
          console.warn(`Warning: Parent project package.json at ${parentPackageJsonPath} does not contain a "name" field. Using default name: ${projectName}`);
        }
      } catch (error) {
        console.warn(`Warning: Could not read or parse parent project's package.json at ${path.join(ctx.dest, '..')}. Error: ${error.message}. Using default project name: ${projectName}`);
      }

    } else {
      // If not using dev path, read versions from the parent project's package.json
      try {
        const parentPackageJsonPath = path.join(ctx.dest, '..', 'package.json');
        const userPackageJsonContent = await fs.readFile(parentPackageJsonPath, 'utf-8');
        const userPackageJson = JSON.parse(userPackageJsonContent);

        if (!userPackageJson.name) {
          throw new Error('Parent project package.json does not contain a "name" field.');
        }
        projectName = userPackageJson.name;

        // Use versions from parent project, or default to 'latest' if not found
        coreVersion = userPackageJson.dependencies?.['@positronic/core'] || coreVersion;
        cloudflareVersion = userPackageJson.dependencies?.['@positronic/cloudflare'] || cloudflareVersion;

      } catch (error) {
        console.warn(`Warning: Could not read or parse parent project's package.json at ${path.join(ctx.dest, '..')}. Error: ${error.message}. Using default project name ('${projectName}') and defaults for Positronic dependency versions ('${coreVersion}', '${cloudflareVersion}').`);
      }
    }

    // Store values in ctx.answers for template rendering
    ctx.answers.projectName = projectName;
    ctx.answers.positronicCoreVersion = coreVersion;
    ctx.answers.positronicCloudflareVersion = cloudflareVersion;
  },

  /**
   * Modifies the template package.json with dynamic dependencies
   * and generates the _manifest.ts file.
   */
  prepare: async ctx => {
    // --- 1. Modify package.json ---
    // This section is removed as versions are now handled by template rendering via ctx.answers set in the setup hook.
    // const packageJsonFile = ctx.files.find(f => f.path === 'package.json');
    // if (!packageJsonFile) {
    //   throw new Error('package.json file not found in template files.');
    // }
    //
    // const packageJson = JSON.parse(packageJsonFile.contents.toString());
    // packageJson.dependencies = packageJson.dependencies;
    //
    // if (!packageJson.dependencies) {
    //   throw new Error('package.json does not contain a "dependencies" field.');
    // }
    //
    // if (!packageJson.dependencies['@positronic/core'] || !packageJson.dependencies['@positronic/cloudflare']) {
    //   throw new Error('package.json does not contain @positronic/core or @positronic/cloudflare dependencies.');
    // }
    // // These lines are replaced by using template variables in package.json.template
    // packageJson.dependencies['@positronic/core'] = ctx.answers.coreVersion;
    // packageJson.dependencies['@positronic/cloudflare'] = ctx.answers.cloudflareVersion;
    //
    // // Check for local development path override
    // // This logic is now handled in the setup hook.
    // const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
    // if (devRootPath) {
    //   console.log(`Found POSITRONIC_PACKAGES_DEV_PATH: ${devRootPath}. Using local file paths for @positronic/* dependencies.`);
    //   for (const dependency of Object.keys(packageJson.dependencies)) {
    //     if (dependency.startsWith('@positronic/')) {
    //       const packageName = dependency.replace('@positronic/', '');
    //       // Construct the absolute path to the local package
    //       const localPackagePath = path.resolve(devRootPath, 'packages', packageName);
    //       // Use file: protocol for local dependency
    //       packageJson.dependencies[dependency] = `file:${localPackagePath}`;
    //       console.log(`  - Mapping ${dependency} to ${packageJson.dependencies[dependency]}`);
    //     }
    //   }
    //
    //   packageJsonFile.contents = Buffer.from(JSON.stringify(packageJson, null, 2));
    // }


    // --- 2. Generate _manifest.ts ---
    // The manifest is now generated by calling the dedicated function.
    // Note: ctx.dest points to the target directory where caz is putting the template,
    // which is the .positronic directory. The project root is one level up.
    const projectRootPath = path.join(ctx.dest, '..');
    const targetSrcDir = path.join(ctx.dest, 'src'); // src dir within .positronic

    // Call the generation function. This will write the file directly.
    // We don't push it to ctx.files anymore as caz doesn't need to handle it.
    try {
      await generateManifest(projectRootPath, targetSrcDir);
    } catch (error) {
      // Log the error but don't necessarily fail the whole caz process
      // unless manifest generation is absolutely critical.
      console.error("Error during initial manifest generation within caz prepare hook:", error);
      // Optionally: throw error; to make caz fail if manifest fails
    }

    // Manifest file is no longer added to ctx.files here
    // ctx.files.push({
    //   path: 'src/_manifest.ts',
    //   contents: Buffer.from(manifestContent)
    // });
  },

  // Export the generation function for external use
  generateManifest: generateManifest
};