const { name, version } = require('./package.json')
const path = require('path')
const { existsSync } = require('fs')

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