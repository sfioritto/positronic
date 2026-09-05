# Maintainer's Guide to the Positronic Project Template

`@positronic/template-new-project` holds the skeleton for a new Positronic project and the code that renders it. Two consumers call it:

- `px project new` in `packages/cli/src/commands/helpers.ts`, which scaffolds a project and then runs `npm install` and `git init`.
- The cloudflare dev server in `packages/cloudflare/src/dev-server.ts`, which scaffolds into a temp directory and copies out `.positronic/` when a project is missing it.

## Layout

- `src/index.ts` exports `scaffoldProject(options)`. It walks `template/`, renders every file through Eta, and writes the result. No prompts, no install, no git. Callers add those. The `subdir` option renders only files under a template subdirectory, stripping that prefix on write — the cloudflare dev server uses it to render only `.positronic/`.
- `template/` is the project skeleton. Every file in it is rendered.
- `package.json` versions the template. `templateData()` reads that version and uses `^<version>` for the `@positronic/*` ranges written into generated projects, so a changeset bump updates them automatically.

## Template syntax

Files use Eta with its default `<% %>` tags, `useWith: true` so variables are bare identifiers, `autoEscape: false` because the output is code and JSON rather than HTML, and `autoTrim: false` so whitespace comes through exactly as written.

- Interpolation: `"projectName": "<%= name %>"`
- Logic: `<% if (backend === 'cloudflare') { %> ... <% } %>`

JavaScript template literals need no escaping. Eta only recognizes its own tags, so `${state.task}` in a code sample renders verbatim. The only thing to avoid in template files is a literal `<%`.

Available variables are whatever `templateData()` returns: `name`, `projectName`, `backend`, `backendPackage`, and the four `positronic*Version` strings. Add a field there when a template needs a new one.

## Special files

`_gitignore` and `_env` are renamed to `.gitignore` and `.env` on output so they do not affect this repository. The mapping lives in the `renames` table in `src/index.ts`. `CLAUDE.md` is skipped when `claudeMd: false`. Every file in `template/` is read as UTF-8 text and rendered, so the template must not contain binary files.

## Local development

`devRootPath` defaults to `POSITRONIC_LOCAL_PATH`, and when that is unset, to auto-detection when this package resolves from a monorepo checkout instead of `node_modules`. Pass `devRootPath` explicitly to override either.

To scaffold by hand from the repo root after a build:

```bash
node --input-type=module -e "
import { scaffoldProject } from '@positronic/template-new-project';
scaffoldProject({ name: 'demo', dest: '/tmp/demo', devRootPath: process.cwd() });
"
```

The CLI tests scaffold once per run in `packages/cli/tests/global-setup.ts` with `backend: 'none'`, then copy that directory for each test.

## Adding a backend

1. Add the value to the `Backend` type in `src/index.ts` and handle its package in `templateData()`.
2. Add the conditional dependency blocks in `template/package.json` and `template/.positronic/package.json`.
3. Add any backend-specific files under `template/`. There is no per-file filter yet; add one to `scaffoldProject()` if a file should only exist for one backend.
