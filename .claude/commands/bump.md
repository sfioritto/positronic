# Bump Command

Bump the version of all workspaces in the Positronic monorepo and publish to npm.

## Usage

```
/bump
```

Always bumps patch version (e.g., 0.0.5 -> 0.0.6)

## What it does

1. Validates git working directory is clean
2. Uses `npm version patch --workspaces` to update all workspace versions
3. Updates hardcoded versions in packages/template-new-project/index.js
4. Runs `npm install` to update package-lock.json
5. Creates a git commit with the version bump
6. Tags the commit with the new version
7. Pushes to the remote repository
8. Publishes all packages to npm

## Steps

First, I'll verify prerequisites:
- Check that git working directory is clean
- Confirm all tests pass

Then I'll:
1. Run `npm version patch --workspaces` to bump all workspace versions
2. Update hardcoded versions in packages/template-new-project/index.js
3. Run `npm install` to update package-lock.json
4. Create commit: "Bump to v{version}"
5. Create tag: "v{version}"
6. Push commit and tag to origin
7. Run `npm publish --workspaces`

## Pre-requisites

- Clean git working directory (no uncommitted changes)
- .npmrc file with authentication configured
- Push access to the repository
- All tests passing

## Example

```
/bump    # Bumps 0.0.5 -> 0.0.6 (patch version only)
```

## Notes

- All workspace versions are kept in sync using npm workspaces
- The command will fail if working directory has uncommitted changes
- npm authentication is configured via .npmrc file