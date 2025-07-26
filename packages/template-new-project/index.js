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
    },
    {
      name: 'claudemd',
      type: 'confirm',
      message: 'Initialize CLAUDE.md for AI-assisted development',
      initial: true
    }
  ],
  setup: async ctx => {
    const devRootPath = process.env.POSITRONIC_LOCAL_PATH;
    let coreVersion = '^0.0.8';
    let cloudflareVersion = '^0.0.8';
    let clientVercelVersion = '^0.0.8';

    // Map backend selection to package names
    const backendPackageMap = {
      'cloudflare': '@positronic/cloudflare',
      'aws': '@positronic/aws-lambda', // Future
      'azure': '@positronic/azure-functions', // Future
      'gcp': '@positronic/gcp-functions', // Future
      'fly': '@positronic/fly', // Future
      'none': null
    };

    ctx.answers.backendPackage = backendPackageMap[ctx.answers.backend];

    if (devRootPath) {
      console.log(`Found POSITRONIC_LOCAL_PATH: ${devRootPath}. Using local file path for @positronic/core.`);
      const corePath = path.resolve(devRootPath, 'packages', 'core');
      coreVersion = `file:${corePath}`;
      console.log(`  - Mapping @positronic/core to ${coreVersion}`);

      // Handle backend packages for local development
      if (ctx.answers.backend === 'cloudflare') {
        const cloudflarePath = path.resolve(devRootPath, 'packages', 'cloudflare');
        if (existsSync(cloudflarePath)) {
          cloudflareVersion = `file:${cloudflarePath}`;
          // Also update the backend package for the config file
          ctx.answers.backendPackage = `file:${cloudflarePath}`;
          console.log(`  - Mapping @positronic/cloudflare to ${cloudflareVersion}`);
        }
      }
      // Add similar blocks for other backends when they exist
      // Example for future backends:
      // if (ctx.answers.backend === 'aws') {
      //   const awsPath = path.resolve(devRootPath, 'packages', 'aws-lambda');
      //   if (existsSync(awsPath)) {
      //     ctx.answers.backendPackage = `file:${awsPath}`;
      //   }
      // }

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

    // Disable git initialization in test environments
    if (process.env.NODE_ENV === 'test') {
      ctx.config.init = false;
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

    // Find our specially named env file in the list of files to be processed
    const envFile = ctx.files.find(file => file.path === '_env');
    if (envFile) {
      // Change its path to '.env' so it's correctly named in the generated project
      envFile.path = '.env';
    }

    // Remove CLAUDE.md if user chose not to include it
    if (!ctx.answers.claudemd) {
      ctx.files = ctx.files.filter(file => file.path !== 'CLAUDE.md');
    }
  },
  complete: async ctx => {
    // Display getting started message
    console.log('\n✨ Project created successfully!\n');
    console.log(`📁 Project location: ${ctx.dest}\n`);

    console.log('🚀 Getting started:\n');
    console.log(`   cd ${ctx.answers.name}`);

    if (!ctx.answers.install) {
      console.log(`   ${ctx.answers.pm || 'npm'} install`);
    }

    console.log('   px server              # Start the development server');
    console.log('   px brain list          # List available brains');
    console.log('   px brain run example   # Run the example brain\n');

    if (ctx.answers.backend === 'cloudflare') {
      console.log('☁️  Cloudflare deployment:\n');
      console.log('   wrangler login         # Authenticate with Cloudflare');
      console.log('   px deploy              # Deploy to Cloudflare Workers\n');
    }

    console.log('📚 Resources:\n');
    console.log('   • Documentation: https://positronic.dev');
    console.log('   • GitHub: https://github.com/positronic-ai/positronic');
    console.log('   • CLI Help: px --help\n');

    if (ctx.answers.claudemd) {
      console.log('💡 Pro tip: Check out CLAUDE.md in your project for AI-assisted development guidance!\n');
    }
  }
}