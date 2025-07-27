# Bump Command

Bump the version of all workspaces in the Positronic monorepo and publish to npm using changesets.

## Usage

```
/bump
```

Always bumps patch version for all linked packages (e.g., 0.0.5 -> 0.0.6)

## What it does

1. Validates git working directory is clean
2. Creates a changeset for patch version bump
3. Runs `changeset version` to update all package versions and inter-package dependencies
4. Updates hardcoded versions in packages/template-new-project/index.js
5. Cleans workspaces to ensure fresh build
6. Reinstalls dependencies
7. Builds all packages and runs tests via npm run dev
8. Commits the version changes
9. Runs `changeset publish` to create tags and publish to npm
10. Pushes commits and tags to the remote repository

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
3. [ ] Create a changeset for patch bump:
   ```bash
   echo "---" > .changeset/bump-patch.md
   echo '"@positronic/core": patch' >> .changeset/bump-patch.md
   echo '"@positronic/spec": patch' >> .changeset/bump-patch.md
   echo '"@positronic/cli": patch' >> .changeset/bump-patch.md
   echo '"@positronic/cloudflare": patch' >> .changeset/bump-patch.md
   echo '"@positronic/shell": patch' >> .changeset/bump-patch.md
   echo '"@positronic/client-anthropic": patch' >> .changeset/bump-patch.md
   echo '"@positronic/client-vercel": patch' >> .changeset/bump-patch.md
   echo '"@positronic/template-new-project": patch' >> .changeset/bump-patch.md
   echo "---" >> .changeset/bump-patch.md
   echo "" >> .changeset/bump-patch.md
   echo "Bump all packages to next patch version" >> .changeset/bump-patch.md
   ```
4. [ ] Run `npx changeset version` to update versions and dependencies
5. [ ] Get the new version number from any package.json (e.g., `grep '"version"' packages/core/package.json`)
6. [ ] Update hardcoded versions in `packages/template-new-project/index.js` (lines 56-58) to match the new version
7. [ ] Run `npm run clean:workspaces` to clean all build artifacts
8. [ ] Run `npm install` to reinstall all dependencies fresh
9. [ ] Run `npm run dev` to build all packages and run all tests
10. [ ] Verify tests pass (if tests fail, STOP and fix issues)
11. [ ] Stage all changes (`git add -A`)
12. [ ] Create commit (`git commit -m "Bump to v{version}"`)
13. [ ] Run `npx changeset publish` to create tags and publish all packages
14. [ ] Push commit and tags (`git push origin main --tags`)

## Important Notes

- ALWAYS build before publishing to ensure the latest code is included
- The command will fail if working directory has uncommitted changes
- npm authentication is configured via .npmrc file
- All workspace versions are kept in sync using changesets linked packages
- Changesets automatically handles inter-package dependency updates
- Verify each step completes successfully before moving to the next
- The changeset file will be automatically deleted after running `changeset version`