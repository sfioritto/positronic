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
4. Cleans workspaces to ensure fresh build
5. Reinstalls dependencies
6. Builds all packages and runs tests via npm run dev
7. Updates package-lock.json
8. Creates a git commit with the version bump
9. Tags the commit with the new version
10. Pushes to the remote repository
11. Publishes all packages to npm

## Pre-requisites

- Clean git working directory (no uncommitted changes)
- .npmrc file with authentication configured
- Push access to the repository
- All tests passing

## Example

```
/bump    # Bumps 0.0.5 -> 0.0.6 (patch version only)
```

## REQUIRED CHECKLIST - Complete these steps IN ORDER:

1. [ ] Check git working directory is clean (`git status --porcelain`)
2. [ ] Verify on main branch (`git branch --show-current`)
3. [ ] Run `npm version patch --workspaces --no-git-tag-version`
4. [ ] Update hardcoded versions in `packages/template-new-project/index.js` (lines 56-58)
5. [ ] Run `npm run clean:workspaces` to clean all build artifacts
6. [ ] Run `npm install` to reinstall all dependencies fresh
7. [ ] Run `npm run dev` to build all packages and run all tests
8. [ ] Verify tests pass (if tests fail, STOP and fix issues)
9. [ ] Stage all changes (`git add -A`)
10. [ ] Create commit (`git commit -m "Bump to v{version}"`)
11. [ ] Create tag (`git tag v{version}`)
12. [ ] Push commit and tag (`git push origin main --tags`)
13. [ ] Run `npm publish --workspaces` to publish all packages

## Important Notes

- ALWAYS build before publishing to ensure the latest code is included
- The command will fail if working directory has uncommitted changes
- npm authentication is configured via .npmrc file
- All workspace versions are kept in sync using npm workspaces
- Verify each step completes successfully before moving to the next