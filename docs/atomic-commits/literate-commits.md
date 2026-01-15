# Literate Commits

*By Pete Corey*

## Overview

Pete Corey explores a modern interpretation of Donald Knuth's literate programming concept, applying it to version control commit histories rather than standalone documents.

## The Challenge with Literate Programming

Corey acknowledges that traditional literate programming, while conceptually powerful, faces practical adoption barriers. He references Peter Norvig's observation that the approach assumes "a single best order of presentation," which doesn't account for diverse reader needs and different entry points into codebases.

## Introducing Literate Commits

Rather than abandoning the literary approach entirely, Corey proposes using detailed, thoughtful commit messages as the vehicle for storytelling. During deliberate practice sessions, he:

- Writes short programs following best practices
- Documents reasoning behind each change
- Creates a project history that reads as narrative

This transforms `git log` from mundane record-keeping into an educational artifact.

## Key Benefits

**Improved Quality**: Knowing commits will be visible encourages doing things right the first time.

**Historical Context**: Detailed commits allow developers to understand not just *what* changed, but *why*—providing crucial context when encountering unfamiliar code sections.

**Professional Development**: The practice reinforces good habits through intentional, observed workflow.

Corey emphasizes this approach works best for deliberate practice rather than production codebases, offering a practical middle ground between ideal documentation and real-world development constraints.
