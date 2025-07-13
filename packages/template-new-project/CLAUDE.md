# Maintainer's Guide to the Positronic Project Template & Caz

This document serves as the complete guide for maintainers of the `@positronic/template-new-project`. It provides a deep dive into the structure of this template, its configuration, and the underlying scaffolding engine, `caz`, that powers it.

This guide assumes no prior knowledge of the `caz` codebase.

## Part 1: The `@positronic/template-new-project`

This project is a `caz` template. Its sole purpose is to generate new Positronic projects by running a command like `npx @positronic/template-new-project <new-project-name>`.

### The Anatomy of the Template

The template is controlled by its `index.js` file, which defines how `caz` should behave. The actual files to be generated live inside the `template/` directory.

#### Key Files

*   **`index.js`**: The brain of the template. This is a configuration file that tells `caz` what questions to ask, what logic to run before generating files, and how to prepare the files.
*   **`package.json`**: This defines the template itself, including its dependencies like `caz`. Note that the dependencies here are for the *template*, not the *generated project*.
*   **`template/`**: This directory contains the skeleton of the project that will be created. Files and filenames here can contain template variables.

#### The Generation Process at a Glance

When a user runs this template, `caz` performs the following high-level steps:

1.  **Prompts**: Asks the user a series of questions defined in `index.js`.
2.  **Setup**: Runs custom logic to process the user's answers and prepare dynamic variables.
3.  **Prepare**: Prepares the list of files to be generated, renaming special files like `_gitignore`.
4.  **Render & Emit**: Copies files from the `template/` directory, injecting variables and processing logic.
5.  **Install & Initialize**: (Optionally) installs dependencies and initializes a Git repository in the new project.

### In-Depth Configuration (`index.js`)

The `index.js` file exports a configuration object that `caz` uses to drive the entire process. Let's break down its key sections.

#### **1. Prompts (`prompts` array)**

This array defines the interactive questions `caz` will ask the user.

*   **`name`**: The name of the new project. Defaults to `my-positronic-project`.
*   **`backend`**: A selection list for the deployment backend. This is critical as it drives which dependencies and configurations are included. Currently, only 'Cloudflare' is enabled.
*   **`install`**: A confirmation to ask whether dependencies should be installed automatically.
*   **`pm`**: A selection list for the package manager (npm, pnpm, yarn), which only appears if the user opts to install dependencies.

#### **2. Pre-Generation Logic (`setup` hook)**

This asynchronous function runs after the user has answered the prompts but before any files are generated. It's used for complex, dynamic configuration.

*   **Local Development with `POSITRONIC_LOCAL_PATH`**: This is a crucial feature for maintainers. If the `POSITRONIC_LOCAL_PATH` environment variable is set (pointing to the root of a local monorepo), the template will map the `@positronic/*` dependencies to local `file:` paths instead of fetching them from `npm`. This allows for simultaneous development and testing of the core libraries and the template.
*   **Backend Package Mapping**: It maps the user's `backend` choice (e.g., 'cloudflare') to a specific npm package name (e.g., `@positronic/cloudflare`).
*   **Dynamic Versioning**: It sets the versions for `@positronic/core`, `@positronic/cloudflare`, and `@positronic/client-vercel` to either `'latest'` or a local `file:` path.
*   **Installation Control**: It sets `ctx.config.install` to the chosen package manager or `false`, telling `caz` whether to run an installation step later.
*   **Context Augmentation**: It adds new properties to `ctx.answers` (like `projectName`, `positronicCoreVersion`, etc.) which can then be used as variables in the template files.

#### **3. File Preparation (`prepare` hook)**

This function runs after `caz` has gathered all the template files but before they are rendered and written to disk. It allows for final manipulation of the file list.

*   **Renaming System Files**: It renames `_gitignore` to `.gitignore` and `_env` to `.env`. This is a common pattern to prevent the template's own `.gitignore` or `.env` from affecting the template repository itself.
*   **Marking Files as Binary**: It iterates through the files and marks any markdown files in the `docs/` directory as binary. This tells `caz`'s rendering engine to skip them, preventing it from trying to inject template variables into the documentation.

### The Template Files (`template/` directory)

Files within this directory are the blueprint for the generated project. They utilize Lodash template syntax.

*   **Variable Injection**: Simple variables are injected using `<%=...%>`.
    *   Example from `template/positronic.config.json`: `"projectName": "<%= name %>"`
*   **Conditional Logic**: JavaScript logic can be embedded with `<%...%>`. This is used powerfully in `template/package.json` to conditionally include dependencies based on the backend choice.
    ```json
    "dependencies": {
      ...
      "@positronic/core": "<%= positronicCoreVersion %>"<% if (backend === 'cloudflare') { %>,
      "@positronic/cloudflare": "<%= positronicCloudflareVersion %>"<% } %>
    }
    ```
*   **File Renaming**: `caz` also supports renaming files that contain `{variable}` syntax in their names, though this template does not currently use that feature.

***

## Part 2: `caz` - The Scaffolding Engine

`caz` is the engine that interprets and executes our template. Understanding its workflow is key to understanding why the template is built the way it is.

### The Core `caz` Workflow (Middleware Chain)

`caz` processes a project in a strict, sequential order of middleware.

1.  **`confirm`**: Checks if the target project directory exists. If it's not empty, it prompts the user to either merge, overwrite, or cancel. The `--force` flag bypasses this.
2.  **`resolve`**: Locates the template. It can be a local path (`./my-template`) or a remote repository (`zce/nm`). Remote templates are downloaded and cached in `~/.cache/caz` for offline use and speed.
3.  **`load`**: Loads the template's configuration (`index.js`). **Crucially, it also runs `npm install --production` inside the template's directory**, installing any `dependencies` listed in the template's `package.json`.
4.  **`inquire`**: Presents the interactive prompts from the `prompts` array to the user. `caz` automatically provides smart defaults and validation for common fields like `name`, `version`, `author`, `email`, and `url` by reading system `.npmrc` and `.gitconfig` files.
5.  **`setup`**: Executes the `setup` hook from the template config, as described above.
6.  **`prepare`**: Reads all files from the `source` directory (`template/` by default). It applies any `filters` defined in the config to conditionally exclude files. After this, it runs the `prepare` hook.
7.  **`rename`**: Scans filenames for `{variable}` patterns and renames them based on user answers.
8.  **`render`**: Scans the content of all non-binary files for template syntax (`<%=...%>` or `${...}`) and renders them using the user's answers and any configured `helpers`.
9.  **`emit`**: Writes the final, rendered files to the destination project directory. It runs an `emit` hook if one is defined.
10. **`install`**: If `config.install` is set to `'npm'`, `'yarn'`, or `'pnpm'`, it runs the corresponding installation command in the new project directory.
11. **`init`**: If `config.init` is `true` (or if a `.gitignore` file is present), it runs `git init`, `git add`, and `git commit`.
12. **`complete`**: Executes the `complete` hook, which is typically used to print a "getting started" message to the user. If not defined, it prints a default message listing the created files.

***

## Part 3: Practical Maintainer Tasks

With this knowledge, here is how to approach common maintenance tasks.

### How to Add a New Backend (e.g., "Fly.io")

1.  **Modify Prompts (`index.js`)**: Add a new choice to the `backend` prompt. You can disable it initially if it's a work in progress.
    ```javascript
    {
      name: 'backend',
      type: 'select',
      message: 'Select your deployment backend',
      choices: [
        { title: 'Cloudflare', value: 'cloudflare' },
        // ...
        { title: 'Fly.io', value: 'fly', disabled: false }, // Add new choice
        { title: 'None (Core only)', value: 'none' }
      ]
    }
    ```
2.  **Update Setup Logic (`index.js`)**:
    *   Add the new backend to `backendPackageMap`.
    *   Add logic to handle the `file:` path for the new backend when `POSITRONIC_LOCAL_PATH` is set.
    *   Add the new dependency version to `ctx.answers`.
3.  **Update Template Files (`template/package.json`)**: Add a conditional block to include the new dependency.
    ```json
    "dependencies": {
        ...
        <% if (backend === 'fly') { %>
        "@positronic/fly": "<%= positronicFlyVersion %>"
        <% } %>
    }
    ```
4.  **Add New Files**: If the new backend requires specific files (e.g., `fly.toml`), add them to the `template/` directory. You can use `filters` in `index.js` to ensure they are only included when that backend is selected.

### How to Test Changes Locally

This is the most important workflow for a maintainer.

1.  Make your changes to the `template-new-project` repository.
2.  In your terminal, navigate to a directory *outside* of the project.
3.  To simulate a normal user's experience, run:
    ```bash
    # Use 'npx caz' to run caz without a global install
    # Point it to the local directory of your template
    # 'my-test-app' is the output directory
    npx caz ./path/to/template-new-project my-test-app --force
    ```
4.  To test with local monorepo packages, set the environment variable first:
    ```bash
    # Point to the root of your positronic monorepo
    export POSITRONIC_LOCAL_PATH=~/dev/positronic

    npx caz ./path/to/template-new-project my-local-test-app --force
    ```
5.  Inspect the generated `my-test-app` or `my-local-test-app` directory to ensure the files and `package.json` are correct. The `--force` flag is useful for quickly re-running the command.

### Gotcha: Accidental Template Processing

The `caz` rendering engine is greedy. It scans every non-binary file for its template syntax. If it finds a match, it will attempt to process the *entire file*, which can cause unexpected behavior or break the scaffolding process.

**Important**: Any file containing text that matches the `<%= ... %>` or `${...}` patterns will be treated as a template and processed by the engine, which can cause errors if the content is not a valid template variable or expression.

For example, imagine you add a new shell script to the template called `configure.sh`:

```sh
#!/bin/bash

# This script configures the local environment
echo "Setting up for user: ${USER}"
```

When `caz` processes this file, it will see `${USER}` and interpret it as a template variable. It will search for a `USER` key in the answers provided by the user during the prompts. If it's not found, the output will likely be `Setting up for user: undefined`, or it could even throw an error, breaking the project generation.

### How to Prevent Accidental Processing

The codebase reveals two ways to handle this, depending on your goal.

1.  **Escaping the Syntax (The Preferred Method)**

    If you need the literal syntax (like `${USER}`) to appear in the final generated file, you must escape it using the template engine itself. The `caz` documentation (`docs/create-template.md`) explicitly describes this:

    *   To output a literal `<%= name %>`, you must write `<%= '\<%= name %\>' %>` in your template file.
    *   To output a literal `${name}`, you must write `<%= '${name}' %>` in your template file.

2.  **Marking the File as Binary**

    If a file should be copied verbatim with no processing whatsoever, the solution is to instruct `caz` to treat it as a binary file. The renderer explicitly skips binary files.

    The `@positronic/template-new-project` template already does this for its documentation files as a preventative measure. You can add a similar rule in the `prepare` hook within `index.js`:

    ```javascript
    // in index.js
    prepare: async ctx => {
      // ... existing prepare logic ...

      // Add a rule to treat all .sh files as binary
      ctx.files.forEach(file => {
        if (file.path.endsWith('.sh')) {
          // This is a made-up property for the example, but it would
          // need to be supported by caz's `isBinary` check.
          // A more robust way is to check the file contents.
          // The key insight is that the prepare hook is where you would
          // manipulate files before rendering.
          // The current template shows a real example for .md files:
          if (file.path.startsWith('docs/') && file.path.endsWith('.md')) {
            file.binary = true; // This is a conceptual flag.
                                // The actual implementation is in caz's `isBinary` check.
          }
        }
      });
    }
    ```
    This tells the `render` step to ignore the file completely, ensuring it is copied as-is.