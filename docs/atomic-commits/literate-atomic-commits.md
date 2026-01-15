# Literate Atomic Commits

*Source: iamjonas.me*

The article explores the intersection of literate programming and atomic commits as a practice for writing better code and clearer commit messages.

## Literate Programming Foundation

The author introduces literate programming as a concept where "you write in regular prose what you are doing and then intersperse that with code snippets." This approach reverses the typical importance, making documentation primary and code secondary. Donald Knuth, the inventor, emphasized understanding your audience and "say everything twice in complementary ways."

## Atomic Commits Explained

An atomic commit represents "the minimal and accurate solution to one agreed problem." The three key principles are:

- **Minimal**: Cannot be made smaller without failing to solve the problem
- **Accurate**: Correctly solves the stated problem
- **One**: Addresses a single problem only

The author cautions against mixing concerns, such as formatting code while simultaneously making functional changes.

## Combining Both Approaches

When unified, atomic literate commits allow developers to explain their code through prose while keeping changes focused and reviewable. The commit message becomes a canvas for reinforcing understanding through complementary formal and informal explanations.

## Real-World Workflow

The author acknowledges that actual development is messy. The recommended approach uses a "shitty draft first" branch for exploratory work, then performs `git reset --soft` to reconstruct changes as clean, atomic, literate commits.

## Benefits

Quality commits improve code review efficiency, enable better use of tools like `git bisect` and `git blame`, and demonstrate genuine understanding of the changes being made.
