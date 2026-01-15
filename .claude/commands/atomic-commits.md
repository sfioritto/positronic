# Atomic Commits Command

Create atomic, literate commits for changes made in the current session, following best practices for meaningful commit history.

## Usage

```
/atomic-commits
```

## Philosophy

Read and internalize these guides before committing:

- `docs/atomic-commits/literate-atomic-commits.md` - Combining literate programming with atomic commits
- `docs/atomic-commits/literate-commits.md` - Using commit messages as storytelling
- `docs/atomic-commits/telling-stories-with-git.md` - Making PRs reviewable through small commits

## Key Principles

1. **Atomic**: Each commit solves exactly ONE problem. Cannot be made smaller without failing to solve that problem.
2. **Literate**: Commit messages explain the "why" in prose, not just the "what".
3. **Narrative**: The sequence of commits should tell a story that reviewers can follow.

## What to do

1. Read all three docs in `docs/atomic-commits/` to understand the philosophy
2. Run `git status` and `git diff` to see all uncommitted changes
3. Analyze the changes and identify logical groupings - each group becomes one commit
4. For each logical unit of change:
   - Stage only the files for that specific change
   - Write a commit message that:
     - Has a clear, concise subject line
     - Explains WHY the change was made (not just what)
     - Provides context a reviewer would need
   - Create the commit
5. Repeat until all changes are committed as clean, atomic units
6. Create a new branch if not already on a feature branch (not main)
7. Push the branch to origin
8. Create a PR using `gh pr create` with:
   - A clear title summarizing the overall change
   - A body that provides context and lists the atomic commits made

## Commit Message Format

```
Short subject line (imperative mood, ~50 chars)

Longer explanation of why this change was made. What problem does it
solve? What was the reasoning? This helps future developers (including
yourself) understand the context.
```

## Important Notes

- Do NOT create one giant commit with all changes
- Do NOT commit unrelated changes together
- If changes are entangled, consider what the ideal sequence would have been
- Ask the user if you're unsure how to split changes
- Do NOT add co-authored-by Claude Code comments to the commit message
