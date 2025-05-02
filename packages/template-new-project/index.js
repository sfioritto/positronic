// @ts-check

// TODO: Add comments explaining the purpose of this file.

const path = require('path')
const { name, version } = require('./package.json')

/** @type {import('caz').Template} */
module.exports = {
  name, // Use name from package.json
  version, // Use version from package.json
  // metadata: {
  //   // TODO: predefined template metadata
  //   year: new Date().getFullYear()
  // },
  prompts: [
    // TODO: custom template prompts
    {
      name: 'name',
      type: 'text',
      message: 'Project name',
      initial: 'my-positronic-project'
    },
    {
      name: 'version',
      type: 'text',
      message: 'Project version',
      initial: '0.1.0'
    },
    {
      name: 'description',
      type: 'text',
      message: 'Project description',
      initial: 'Positronic project'
    },
    {
      name: 'author',
      type: 'text',
      message: 'Project author name'
    },
    {
      name: 'email',
      type: 'text',
      message: 'Project author email'
    },
    {
      name: 'url',
      type: 'text',
      message: 'Project author url'
    },
    {
      name: 'github',
      type: 'text',
      message: 'GitHub username or organization'
    },
    {
      name: 'install', // Added missing install prompt
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
  // filters: {
  //   // TODO: custom template filters
  //   /** @param {{ features: string[] }} answers */
  //   'src/*.test.js': answers => answers.features.includes('test'),
  //   'src/setupTests.js': answers => answers.features.includes('test')
  // },
  // helpers: {
  //   // TODO: custom template helpers
  //   upper: input => input.toUpperCase()
  // },
  setup: ctx => {
    // TODO: dynamic setup based on answers
    // Uses 'pm' answer if available, otherwise defaults to 'npm'
    // Ensure install is only set if the user confirmed installation
    if (ctx.answers.install) {
      const pm = ctx.answers.pm;
      // Check if pm is one of the valid package managers
      if (pm === 'npm' || pm === 'pnpm' || pm === 'yarn') {
        ctx.config.install = pm;
      } else {
        // Default to npm if the answer is something unexpected (or undefined)
        ctx.config.install = 'npm';
      }
    } else {
      ctx.config.install = false;
    }
  },
  // complete: async ctx => {
  //   // TODO: custom complete callback
  //   console.clear()
  //   console.log(`Created a new project in ${ctx.project} by the ${ctx.template} template.\n`)
  //   console.log('Getting Started:')
  //   if (ctx.dest !== process.cwd()) {
  //     console.log(`  $ cd ${path.relative(process.cwd(), ctx.dest)}`)
  //   }
  //   if (ctx.config.install === false) {
  //     console.log('  $ npm install')
  //   }
  //   console.log(`  $ ${ctx.config.install ? ctx.config.install : 'npm'} run start`)
  //   console.log('\nHappy hacking :)\n')
  // }
}