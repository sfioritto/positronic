const { name, version } = require('./package.json')

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
  setup: ctx => {
    if (ctx.answers.install) {
      const pm = ctx.answers.pm;
      ctx.config.install = pm;
    } else {
      ctx.config.install = false;
    }
  }
}