const { name, version } = require('./package.json')
const path = require('path')
const fs = require('fs/promises')

module.exports = {
  name,
  version,
  prompts: [
    {
      name: 'name',
      type: 'text',
      message: 'Project name',
      initial: 'my-positronic-project'
    },
    {
      name: 'install',
      type: 'confirm',
      message: 'Install dependencies',
      initial: true
    },
    {
      name: 'pm',
      // If testing, allow select, else null means skip prompt -- Removed conditional type
      type: 'select', // Always show the select prompt
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
    let coreVersion = 'latest'; // Default

    if (devRootPath) {
      console.log(`Found POSITRONIC_LOCAL_PATH: ${devRootPath}. Using local file path for @positronic/core.`);
      const corePath = path.resolve(devRootPath, 'packages', 'core');
      coreVersion = `file:${corePath}`;
      console.log(`  - Mapping @positronic/core to ${coreVersion}`);
    } else {
      // If not using dev path, try reading the version from the parent project's package.json
      try {
        // ctx.dest points to the directory where caz outputs the template, which is the project root for `new`
        const parentPackageJsonPath = path.join(ctx.dest, 'package.json');
        const userPackageJsonContent = await fs.readFile(parentPackageJsonPath, 'utf-8');
        const userPackageJson = JSON.parse(userPackageJsonContent);
        coreVersion = userPackageJson.dependencies?.['@positronic/core'] || coreVersion;
      } catch (error) {
        // It's okay if package.json doesn't exist yet or is unreadable during `positronic new`
        // console.warn(`Warning: Could not read or parse project package.json at ${path.join(ctx.dest, '..')}. Error: ${error.message}. Using default version for @positronic/core: ${coreVersion}`);
      }
    }

    // Store value in ctx.answers for template rendering
    ctx.answers.positronicCoreVersion = coreVersion;

    // Handle install/pm selection from prompts
    if (ctx.answers.install) {
      const pm = ctx.answers.pm;
      ctx.config.install = pm; // Set install to 'npm', 'pnpm', or 'yarn'
    } else {
      ctx.config.install = false; // Explicitly disable install
    }
  }
}