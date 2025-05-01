/**
 * Caz template configuration.
 * @type {import('caz').Template}
 */
module.exports = {
  name: 'positronic-new-project',
  version: '0.0.1',
  source: 'template',
  prompts: [
    {
      name: 'projectName',
      type: 'text',
      message: 'Project name'
    },
    // Add other prompts needed based on the old template logic
  ],
  // Enable automatic dependency installation after files are generated.
  // Caz will detect the package manager (npm, yarn, pnpm) if available,
  install: true, // Automatically runs install if package.json exists
  init: true, // Automatically runs git init if .gitignore exists
  // Add filters, helpers, setup, complete hooks as needed
  complete: ctx => {
    console.log(`Success! Created project '${ctx.answers.projectName}' at ${ctx.dest}`);
    console.log("Next steps:");
    if (ctx.dest !== process.cwd()) { // Only show cd if not in the current directory
      console.log(`  cd ${ctx.project}`);
    }
    console.log(`  positronic server  # Start the local development server`);
    console.log(`  positronic run example # Run the example brain (in another terminal)`);
  }
};