---
name: journal
description: Developer journal that documents work as it happens — paths tried, dead ends, and solutions found. Activates when working on non-trivial tasks to maintain a living record of development decisions. Also captures high-level design discussions and brainstorming that happen before execution begins.
user-invocable: false
---

# Developer Journal

You maintain a developer journal that captures the story of work as it happens. This runs in the background — you don't ask the user for permission to journal, you just do it.

## Journal location

All journal pages live in `docs/journal/`. Each effort gets its own file.

## When to start a new journal page

Start a new page when:
- The user begins a non-trivial task (not a one-liner fix or quick question)
- The user is discussing design decisions, brainstorming approaches, or planning before execution
- There's no active journal page for the current effort
- The user explicitly starts a new effort

Do NOT journal for:
- Simple questions or explanations unrelated to active development
- Trivial one-line fixes
- Reading/exploring code without making changes

## File naming

Files are named: `YYYY-MM-DD-short-slug.md` (e.g., `2026-03-10-auth-timeout-fix.md`)

If continuing work from a previous session, reuse the existing file — don't create a new one. Read `docs/journal/` at the start of a session to find any active efforts.

## Page format

```markdown
# [Short title of the effort]

**Status:** active | shipped | abandoned
**Started:** YYYY-MM-DD
**Shipped:** YYYY-MM-DD (when applicable)

## Goal

One or two sentences describing what we're trying to accomplish.

## Log

### [Timestamp or short label]

What was tried, what happened, why it did or didn't work.
Keep entries concise but capture the *reasoning*, not just the actions.

## Dead ends

Approaches that were tried and abandoned. For each:
- What was the approach
- Why it seemed promising
- Why it didn't work

## Solution

(Filled in when the effort ships)
What we actually did and why it works.
```

## When to write

Update the journal at these moments:
- **During design discussion** — capture the options considered, tradeoffs discussed, and decisions made before any code is written
- **Starting an investigation** — what are we looking at and why
- **After a dead end** — what we tried, why it failed, move it to the Dead Ends section
- **When switching approaches** — why we're pivoting
- **When something works** — capture the solution
- **At the end of a session** — summarize where things stand

You don't need to log every file read or tool call. Capture the *decisions and reasoning* at meaningful turning points.

## The commit strategy

The journal commit always rides on top of HEAD. Here's the protocol:

### Creating the initial journal commit

1. Create/edit the journal file in `docs/journal/`
2. `git add docs/journal/`
3. `git commit -m "journal: [short description of effort]"`

### Updating the journal (most common)

1. Edit the journal file
2. `git add docs/journal/`
3. `git commit --amend --no-edit`

This amends the existing journal commit — no new commits, working tree stays clean.

### When the user makes a real commit

Before committing the user's actual work:

1. Soft-reset the journal commit: `git reset --soft HEAD~1`
2. Unstage journal files: `git restore --staged docs/journal/`
3. Make the user's commit (stage their files, commit)
4. Re-stage and re-commit the journal: `git add docs/journal/ && git commit -m "journal: [same description]"`

This slots the real commit underneath and puts the journal back on top.

**Important:** The `/commit` and `/atomic-commits` commands don't know about this protocol. When the user invokes those, you need to handle the journal commit shuffle yourself before and after.

### When the effort ships

When the user says the work is done, or it's clear the effort has concluded:

1. Update the journal page: set status to `shipped`, fill in the Solution section
2. The journal commit becomes a real commit — stop amending it, it's now part of history

### When the effort is abandoned

1. Update the journal page: set status to `abandoned`, note why
2. The journal commit becomes a real commit — same as shipping, it's now permanent

## Resuming across sessions

At the start of any session where you'll be doing non-trivial work:

1. Check `docs/journal/` for files with `Status: active`
2. If one exists and relates to the current work, read it to get context
3. Check if HEAD commit message starts with `journal:` — if so, you can continue amending it
4. If HEAD is not a journal commit (user may have done other work), create a new journal commit on top

## Tone

Write like a developer's notebook — informal, direct, focused on "what" and "why". Not a formal document. Think lab notebook, not report.
