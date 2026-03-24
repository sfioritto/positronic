# Creating Plugins

Plugins let you add services, tools, and event handlers to brains. A plugin bundles everything related to an integration into a single unit.

## Quick Start

```typescript
// src/plugins/weather.ts
import { definePlugin } from '@positronic/core';
import { z } from 'zod';

export const weather = definePlugin({
  name: 'weather',
  create: () => ({
    async forecast(city: string) {
      const res = await fetch(<%= '\`https://api.weather.com/v1/${city}\`' %>);
      return res.json();
    },
  }),
});
```

Use it in a brain:

```typescript
import { brain } from '../brain.js';
import { weather } from '../plugins/weather.js';

export default brain('daily-report')
  .withPlugin(weather)
  .step('Get Weather', async ({ weather: w }) => {
    const forecast = await w.forecast('Seattle');
    return { forecast };
  });
```

## Plugin Anatomy

A plugin has three parts:

- **`name`** — identifies the plugin. This is the key on StepContext (e.g., `ctx.weather`).
- **`setup`** — (optional) defines a config shape. Returns a configured plugin when called.
- **`create`** — called once per brain run. Returns the plugin's public API.

### Without config

```typescript
export const myPlugin = definePlugin({
  name: 'myPlugin',
  create: () => ({
    doStuff: () => 'done',
  }),
});

// Usage: brain('x').withPlugin(myPlugin)
// Access: ({ myPlugin }) => myPlugin.doStuff()
```

### With config

```typescript
export const slack = definePlugin({
  name: 'slack',
  setup: (config: { defaultChannel: string; token: string }) => config,
  create: ({ config }) => ({
    async post(channel: string, message: string) {
      // config.token is available here
    },
  }),
});

// Usage: brain('x').withPlugin(slack.setup({ defaultChannel: '#general', token: '...' }))
// Access: ({ slack }) => slack.post('#alerts', 'hello')
```

## What `create` Receives

```typescript
create: ({ config, brainTitle, currentUser, brainRunId }) => {
  // config — whatever setup() returned, or undefined
  // brainTitle — the brain's title string
  // currentUser — { name: string } of the user running the brain
  // brainRunId — unique ID for this brain run
}
```

Use these to scope your plugin's behavior per brain and user.

## Adding Tools

Tools are functions the LLM can call during prompt loops. Return them under a `tools` key:

```typescript
export const notes = definePlugin({
  name: 'notes',
  create: () => {
    const saved: string[] = [];

    return {
      // Service methods — direct access in steps
      getAll: () => [...saved],

      // Tools — for LLM tool-calling in prompt loops
      tools: {
        saveNote: {
          description: 'Save a note for later',
          inputSchema: z.object({
            note: z.string().describe('The note to save'),
          }),
          async execute(input: { note: string }) {
            saved.push(input.note);
            return { saved: true };
          },
        },
      },
    };
  },
});
```

Using tools in a prompt loop:

```typescript
brain('note-taker')
  .withPlugin(notes)
  .prompt('Take Notes', ({ notes: n }) => ({
    message: 'Listen to the user and save important notes',
    outputSchema: z.object({ summary: z.string() }),
    loop: {
      tools: { ...n.tools },
    },
  }))
```

## Adding an Adapter

An adapter receives brain events (START, STEP_COMPLETE, COMPLETE, ERROR, etc.). Use it for logging, indexing, or side effects:

```typescript
export const analytics = definePlugin({
  name: 'analytics',
  setup: (config: { endpoint: string }) => config,
  create: ({ config, brainTitle }) => ({
    adapter: {
      dispatch(event: any) {
        if (event.type === 'COMPLETE') {
          fetch(config!.endpoint, {
            method: 'POST',
            body: JSON.stringify({ brain: brainTitle, event: 'completed' }),
          });
        }
      },
    },
  }),
});
```

The adapter is intercepted by the framework — it does NOT appear on StepContext.

## Multiple Plugins

Declare multiple plugins upfront in the `brain()` call:

```typescript
brain({ title: 'my-brain', plugins: { slack, mem0, analytics } })
  .step('Go', ({ slack, mem0 }) => {
    // Both available, fully typed
  });
```

Or chain `.withPlugin()` calls:

```typescript
brain('my-brain')
  .withPlugin(slack.setup({ token: '...' }))
  .withPlugin(mem0.setup({ apiKey: '...' }))
```

## Project-Wide Plugins

Configure plugins once in `src/brain.ts` so all brains get them:

```typescript
import { createBrain } from '@positronic/core';
import { components } from './components/index.js';
import { mem0 } from '@positronic/mem0';

export const brain = createBrain({
  plugins: [mem0.setup({ apiKey: process.env.MEM0_API_KEY! })],
  components,
});
```

Individual brains can add more plugins with `.withPlugin()`. If a brain calls `.withPlugin()` with a plugin that shares a name with a project-level one, the per-brain config wins.

## Testing Plugins

In tests, create a plugin with mock behavior:

```typescript
const mockSlack = definePlugin({
  name: 'slack',
  create: () => ({
    post: jest.fn(async () => {}),
  }),
});

const testBrain = brain('test')
  .withPlugin(mockSlack)
  .step('Notify', async ({ slack }) => {
    await slack.post('#general', 'hello');
    return { notified: true };
  });
```

## Plugin Scoping

`create()` is called **per brain run** — each run gets a fresh instance. For nested brains (`.brain()` steps), inner brains get their own `create()` call with the inner brain's title and context. This means plugins are automatically scoped per brain.
