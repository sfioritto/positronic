const { name, version } = require('./package.json')
const path = require('path')
const fs = require('fs/promises')
const { existsSync } = require('fs')

async function generateManifest(projectRootPath, targetSrcDir) {
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

  // Intentionally removing error handling per user request
  await fs.mkdir(targetSrcDir, { recursive: true });
  await fs.writeFile(manifestPath, manifestContent, 'utf-8');

}

module.exports = {
  name,
  version,
  generateManifest,
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
    }

    ctx.answers.positronicCoreVersion = coreVersion;
    if (ctx.answers.backend === 'cloudflare') {
      ctx.answers.positronicCloudflareVersion = cloudflareVersion;
    }

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
  // --- ADD emit hook ---
  emit: async ctx => {
    if (ctx.answers.backend === 'cloudflare') {
      const projectRootPath = ctx.dest;
      const targetDirForManifest = path.join(ctx.dest, '.positronic', 'src');
      await generateManifest(projectRootPath, targetDirForManifest);
    }
  },
  complete: async ctx => {
    const relativeDest = path.relative(process.cwd(), ctx.dest);
    const cdCmd = relativeDest === '' ? '' : `cd ${relativeDest}`;
    let message = `Created Positronic project \`${ctx.answers.name}\` with \`${ctx.answers.backend}\` backend in \`${relativeDest || '.'}\`.\\n\\nGetting Started:\\n`;
    if (cdCmd) {
      message += `  $ ${cdCmd}\\n`;
    }
    if (ctx.config.install === false) {
      message += `  $ npm install # or pnpm install / yarn\\n`;
    }
    if (ctx.answers.backend === 'cloudflare') {
      message += `  $ npx wrangler dev .positronic/dist/index.mjs --local # Start local dev server\\n`;
      message += `  $ npm run deploy # Deploy to Cloudflare\\n`;
    }
    message += '\\nHappy hacking :)';
    return message;
  }
}