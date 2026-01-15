# Atomic Commits: Telling Stories with Git

*By Frederick Van Brabant — December 7, 2017*

## Overview

The article advocates for "atomic commits" (also called micro commits) as a Git best practice for creating more meaningful pull requests and improving code review processes.

## Key Concept

"Atomic commits, sometimes also called micro commits, is the practice of explaining your thought process in the form of commit messages and code."

The author illustrates this through a practical example showing how a simple NewsController method could be built through sequential, logically-grouped commits rather than one massive change.

## Main Benefits

**Enhanced Code Reviews:** Small, focused commits make pull requests more digestible and help reviewers understand the developer's reasoning at each step.

**Knowledge Transfer:** Detailed commit history serves as passive education for junior developers, demonstrating workflow and problem-solving approaches.

**Cherry-picking Simplification:** Smaller units of work make Git operations like cherry-picking more straightforward.

**Team Motivation:** Reviewers stay engaged when reviewing smaller, manageable chunks rather than overwhelming large PRs.

## Counter to Common Objections

The author acknowledges the effort required but dismisses two frequent excuses: that atomic commits are "too much work" and that they clutter the main branch. The latter can be addressed through commit squashing before merging.
