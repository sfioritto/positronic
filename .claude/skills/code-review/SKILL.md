---
name: code-review
description: Review current diffs for opportunities to dramatically simplify and reduce code changes. Activates automatically after completing all tasks from a plan implementation.
---

# Code Review

Look at the current diffs (staged and unstaged) and do a code review focused on one question:

**What could we do differently to dramatically simplify and reduce the number of code changes needed?**

Consider:

- Are there simpler approaches that achieve the same outcome with fewer touch points?
- Are we over-engineering or adding unnecessary abstractions?
- Could we reuse existing patterns or utilities instead of creating new ones?
- Are there changes that aren't strictly necessary for the goal?
- Could the same behavior be achieved by changing fewer files?

Be direct and specific. Point to concrete alternatives, not vague suggestions.
