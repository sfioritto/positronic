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
3. [ ] Get the last published version tag (`git describe --tags --abbrev=0`)
4. [ ] Analyze changes since last release:
   - Run `git log --oneline [last-tag]..HEAD` to see commit messages
   - Run `git diff --stat [last-tag]..HEAD` to see changed files
   - Run `git diff [last-tag]..HEAD -- '*.md' '*.json' '*.ts' '*.tsx' '*.js'` to see actual code changes
   - Based on the logs and diffs, create a meaningful changelog message that summarizes:
     * Key features added
     * Bugs fixed
     * Dependencies updated
     * Breaking changes (if any)
     * Other improvements
5. [ ] Create a changeset file with the custom message:
   ```bash
   cat > .changeset/bump-patch.md << 'EOF'
   ---
   "@positronic/core": patch
   "@positronic/spec": patch
   "@positronic/cli": patch
   "@positronic/cloudflare": patch
   "@positronic/shell": patch
   "@positronic/client-anthropic": patch
   "@positronic/client-vercel": patch
   "@positronic/template-new-project": patch
   ---

   [INSERT YOUR CUSTOM CHANGELOG MESSAGE HERE]
   EOF
   ```
6. [ ] Run `npx changeset version` to update versions and dependencies
7. [ ] Get the new version number from any package.json (e.g., `grep '"version"' packages/core/package.json`)
8. [ ] Update hardcoded versions in `packages/template-new-project/index.js` (lines 56-58) to match the new version
9. [ ] Run `npm run clean:workspaces` to clean all build artifacts
10. [ ] Run `npm install` to reinstall all dependencies fresh
11. [ ] Run `npm run dev` to build all packages and run all tests
12. [ ] Verify tests pass (if tests fail, STOP and fix issues)
13. [ ] Stage all changes (`git add -A`)
14. [ ] Create commit (`git commit -m "Bump to v{version}"`)
15. [ ] Run `npx changeset publish --no-git-tag` to publish all packages without creating individual package tags
16. [ ] Create a single version tag (`git tag v{version}`)
17. [ ] Push commit and tag (`git push origin main --tags`)

## Important Notes

- ALWAYS build before publishing to ensure the latest code is included
- The command will fail if working directory has uncommitted changes
- npm authentication is configured via .npmrc file
- All workspace versions are kept in sync using changesets linked packages
- Changesets automatically handles inter-package dependency updates
- Verify each step completes successfully before moving to the next
- The changeset file will be automatically deleted after running `changeset version`