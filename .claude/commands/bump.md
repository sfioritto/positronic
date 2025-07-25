# Bump Command

Bump the version of all workspaces in the Positronic monorepo and publish to npm.

## Usage

```
/bump [patch|minor|major]
```

Default: patch

## What it does

1. Validates git working directory is clean
2. Updates version in all workspace package.json files
3. Updates hardcoded versions in packages/template-new-project/index.js
4. Updates package-lock.json
5. Creates a git commit with the version bump
6. Tags the commit with the new version
7. Pushes to the remote repository
8. Publishes all packages to npm

## Steps

First, I'll verify prerequisites:
- Check that git working directory is clean
- Ensure npm authentication is configured
- Confirm all tests pass

Then I'll:
1. Read current version from packages/core/package.json
2. Calculate new version based on bump type
3. Update package.json in all workspaces:
   - packages/core
   - packages/cli
   - packages/spec
   - packages/cloudflare
   - packages/client-anthropic
   - packages/client-vercel
   - packages/shell
   - packages/template-new-project
4. Update hardcoded versions in packages/template-new-project/index.js (lines 56-58)
5. Run `npm install` to update package-lock.json
6. Create commit: "Bump to v{version}"
7. Create tag: "v{version}"
8. Push commit and tag to origin
9. Run `npm publish --workspaces`

## Pre-requisites

- Clean git working directory (no uncommitted changes)
- npm authentication configured (run `npm login` first)
- Push access to the repository
- All tests passing

## Example

```
/bump          # Bumps 0.0.5 -> 0.0.6 (patch)
/bump patch    # Bumps 0.0.5 -> 0.0.6
/bump minor    # Bumps 0.0.5 -> 0.1.0
/bump major    # Bumps 0.0.5 -> 1.0.0
```

## Notes

- All workspace versions are kept in sync
- The command will fail if working directory has uncommitted changes
- npm authentication can be configured with `npm login` or NPM_TOKEN environment variable