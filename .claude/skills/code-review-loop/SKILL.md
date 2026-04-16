---
name: code-review-loop
description: >
  Iterative code review loop. Runs an independent code review via a
  fresh-context subagent, evaluates the feedback, implements fixes in
  parallel, and repeats until the feedback is no longer actionable.
---

# Code Review Loop

You are about to run an iterative code review loop. Follow this
process exactly.

## Step 1: Gather the diffs yourself

Run `git diff HEAD` yourself in this session to capture all
uncommitted changes (staged and unstaged). Subagents sometimes
can't run git diff, so you must do this yourself and pass the
output to the reviewer.

If there are no diffs, stop — there's nothing to review.

## Step 2: Run the code-reviewer subagent

Spawn a subagent with the following properties:

- **Model**: opus
- **Tools**: Read, Glob, Grep (read-only — no writes)
- **Fresh context**: The subagent must have NO knowledge of what
  you've been working on, your plan, your reasoning, or any prior
  review passes. It sees only the diffs and the review prompt below.

Pass the subagent exactly this prompt, with the diffs substituted in:

---

You are doing a code review. Here are the current diffs:

```
[PASTE THE GIT DIFF OUTPUT HERE]
```

Look at these diffs and do a code review focused on one question:

**What could we do differently to dramatically simplify and reduce
the number of code changes needed?**

Consider:

- Are there simpler approaches that achieve the same outcome with fewer touch points?
- Are we over-engineering or adding unnecessary abstractions?
- Could we reuse existing patterns or utilities instead of creating new ones?
- Are there changes that aren't strictly necessary for the goal?
- Could the same behavior be achieved by changing fewer files?

Be direct and specific. Point to concrete alternatives, not vague suggestions.

---

## Step 3: Evaluate the feedback

When the code-reviewer subagent returns, read every suggestion
against your full context. You know why the changes were made, what
constraints exist, and what tradeoffs were considered. The reviewer
doesn't.

For each suggestion, decide:

- **Actionable**: The reviewer spotted a real opportunity to simplify
  or improve or fix something that you agree with. Note what needs to
  change.
- **Not actionable**: The reviewer is missing context, the suggestion
  doesn't actually simplify things, or you've already considered and
  rejected the approach. Move on.

## Step 4: Implement fixes in parallel

For each actionable suggestion, spawn a separate implementer
subagent with:

- **Model**: sonnet
- **Tools**: Read, Write, Edit, Glob, Grep, Bash

Give each implementer a specific, scoped task: which file(s) to
change, what the change is, what the expected behavior is, and any
constraints. Each implementer handles one suggestion independently.

**Spawn them in parallel** so they run concurrently.

If there are no actionable suggestions, skip to Step 6.

## Step 5: Verify and repeat

After all implementers finish, review their outputs to make sure
they did what you asked. If any implementer went off track, correct
it yourself or send it back.

Then return to Step 1: gather fresh diffs and run the code-reviewer
subagent again with completely fresh context.

## Step 6: Terminate

Stop the loop when:

- The review comes back with nothing you'd actually change
- The feedback is circular or repeating themes you've already
  considered
- The suggestions aren't about simplification — they're just
  different, not simpler

When you stop, summarize:

- How many review passes you ran
- What you changed based on review feedback
- What feedback you declined and why (briefly)

## Key principles

- **You are the arbiter.** The reviewer will always have opinions.
  You decide what's worth doing.
- **Fresh context every pass.** The reviewer never sees your plan,
  your reasoning, or previous review feedback. This is the point —
  it catches things you're too close to see.
- **Parallel implementation.** Each fix is independent. Run them
  concurrently to save time.
- **Don't over-loop.** Most work should converge in 1-3 passes.
  If you're on pass 4+, stop and summarize.
