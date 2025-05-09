# 🧠 Positronic: A TypeScript library and CLI for headless agents and task automation.

## 💡 The Thesis

AI is not going to replace entire jobs all at once—but it _will_ eat up thousands of painful, repetitive, high-context tasks that we've historically ignored or underinvested in.

These are the kinds of tasks that:

- Require working over **large, structured-but-fuzzy datasets** (e.g. codebases, content archives, policies)
- Demand **non-deterministic transformations** (e.g. refactoring, summarizing, rewriting, replatforming)
- Involve **judgment**, not just rules
- Have **real value**—but not enough to justify full-blown software or human effort
- Couldn't be automated before… but can be now

We built **Positronic** for exactly this kind of work.

## 🚀 What Positronic Does

Positronic is an **open source framework** for building **headless, agent-based workflows** in TypeScript. You can define custom workflows that use LLMs (like GPT) to transform data, make decisions, and emit events—all without building a UI.

It's CLI-first, works great with CRON jobs, and outputs useful artifacts like:

- Markdown summaries
- GitHub PRs
- Slack messages
- Structured diffs

You define workflows using a composable builder pattern, mixing deterministic logic (`step`) with AI reasoning (`prompt`).

## 🧱 Where Positronic Fits

Positronic is _not_ a chatbot. It's _not_ Zapier. It's not another app builder.

Instead, it sits in a sweet spot between:

- 🧠 _Agent frameworks_, which are too abstract or fragile
- 🛠 _SaaS tools_, which can't handle org-specific complexity
- ⚙️ _Hardcoded scripts_, which break when things aren't deterministic

Use it for the stuff that's **too messy for rules** and **too boring for humans**—but still **important enough** to get right.

## ✅ Example Use Cases

Here are six real-world workflows that Positronic handles beautifully.

### 🧠 For Non-Developer Teams

#### 1. Rewrite Internal SOPs for New Tone

Update hundreds of docs to match a friendlier, more on-brand tone.

```ts
export const rewriteSOP = workflow('rewrite-sop')
  .step('load', async ({ input }) => ({ doc: await loadFromDocs(input.id) }))
  .prompt('rewrite', async ({ state }) => ({
    system: `You are an HR writer.`,
    context: state.doc,
    instructions: `Rewrite this using our 2024 tone guide.`,
  }));
```

#### 2. Summarize Exit Interviews

Synthesize qualitative feedback across dozens of offboarded employees.

```ts
export const summarizeExitInterviews = workflow('exit-summary')
  .step('load', async () => ({ interviews: await loadCSV('interviews.csv') }))
  .prompt('summarize', async ({ state }) => ({
    system: `You are an HR analyst.`,
    context: state.interviews,
    instructions: `Summarize themes, issues, and feedback trends.`,
  }));
```

#### 3. SEO Rewrite for Product Descriptions

Update all your PDPs to reflect new SEO goals and keywords.

```ts
export const seoRewrite = workflow('seo-rewrite')
  .step('load', async ({ input }) => ({
    copy: await loadCopy(input.productId),
    keywords: await fetchKeywords(input.productId),
  }))
  .prompt('rewrite', async ({ state }) => ({
    system: `You are an e-commerce copywriter.`,
    context: { ...state },
    instructions: `Rewrite to naturally include these keywords and keep the tone consistent.`,
  }));
```

### 🔧 For Developers

#### 4. Write Tests for Untested Functions

Auto-generate test coverage for key untested logic.

```ts
export const writeMissingTests = workflow('write-tests')
  .step('load', async () => ({
    files: await glob('src/**/*.ts'),
    coverage: await loadCoverage(),
  }))
  .prompt('generate', async ({ state }) => ({
    system: `You are a senior engineer.`,
    context: state,
    instructions: `Write Jest tests for these uncovered functions.`,
  }));
```

#### 5. Remove Dead Code

Find and safely delete unused functions or components.

```ts
export const pruneDeadCode = workflow('dead-code')
  .step('load', async () => ({ graph: await buildUsageGraph() }))
  .prompt('detect', async ({ state }) => ({
    system: `You are reviewing a codebase.`,
    context: state.graph,
    instructions: `Identify unused exports and mark them for safe deletion.`,
  }));
```

#### 6. Migrate from React Class Components to Hooks

Iteratively convert legacy React code using LLM judgment.

```ts
export const migrateReactHooks = workflow('react-hooks')
  .step('load', async () => ({ components: await findClassComponents('src/') }))
  .prompt('refactor', async ({ state }) => ({
    system: `You are a React engineer.`,
    context: state.components,
    instructions: `Convert these to function components using hooks.`,
  }));
```

## 🧑‍🚀 Why This Matters

There's an entire layer of work in every company that:

- Never justified a SaaS product
- Was too messy for rule-based automation
- And was too tedious for anyone to do manually

Positronic makes that work automatable for the first time.

It's the missing tool for the messy middle—where AI shines.

- ⚡️ Build a real workflow in under 10 minutes.
- 🤖 Use AI for what it's good at: smart, fuzzy decisions.
- 🧩 Integrate with your tools—no UI required.
