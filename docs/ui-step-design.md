# UI Step Design

## Intention

- **`ui()` step** generates a page via an agent loop with component tools
- **Input**: User provides a prompt (template + optional responseSchema)
- **Agent runs** with:
  - Framework system prompt: "You generate UI pages. Use component tools."
  - User's prompt (from template): describes what to show/collect, includes schema requirements
  - Schema (from prompt): informs form structure
- **Output**: Page created, `page` object available to next step (ephemeral, like response)
- **Form submits** → mechanical transform to JSON → Zod validates → webhook resolves → page deleted

---

## Prompt Factory

One `prompt()` factory, `responseSchema` optional:

```typescript
// With schema - structured output
const digestPrompt = prompt({
  template: ({ emails }) => `
    Present these ${emails.length} emails grouped by category.
    Let the user select which ones to archive.
  `,
  responseSchema: z.object({
    archiveIds: z.array(z.string()),
    note: z.string().optional(),
  }),
});

// Without schema - text output
const summaryPrompt = prompt({
  template: ({ context }) => `Summarize this: ${context}`,
});
```

---

## Step Behaviors

**Prompt step with schema**: Structured output merged into state
```typescript
.prompt('Digest', digestPrompt)
// State: { ..., Digest: { archiveIds: string[], note?: string } }
```

**Prompt step without schema**: Text response ephemeral in next step
```typescript
.prompt('Summary', summaryPrompt)
.step('UseSummary', ({ state, response }) => {
  // response: { text: string }
  return { ...state, summary: response.text };
})
```

**UI step with schema**: Page with form, webhook available
```typescript
.ui('ShowDigest', digestPrompt)
.step('NotifyAndWait', ({ state, page }) => {
  // page: { link: string, webhook: WebhookRegistration<Schema> }
  sendNtfy(page.link);
  return { state, waitFor: [page.webhook] };
})
.step('Archive', ({ state, response }) => {
  // response: { archiveIds: string[], note?: string }
})
```

**UI step without schema**: Display-only page, no form
```typescript
.ui('Dashboard', summaryPrompt)
.step('Notify', ({ state, page }) => {
  // page: { link: string, webhook: null }
  sendNtfy(page.link);
  return state;
})
```

---

## Type Flow

| After | Available in next step | Type |
|-------|------------------------|------|
| `.prompt()` with schema | merged into state | `state[name]: z.infer<Schema>` |
| `.prompt()` without schema | response (ephemeral) | `{ text: string }` |
| `.ui()` | page (ephemeral) | `{ link: string, webhook: WebhookRegistration<Schema> \| null }` |
| `waitFor: [webhook]` | response (ephemeral) | `z.infer<WebhookSchema>` |

`page` follows the same pattern as `response` - new type parameter on Brain (`TPage`) that:
1. `.ui()` sets to `Page<Schema>`
2. Next `.step()` receives as `page` param
3. That step resets it to `undefined`

`response` is overloaded - type depends on whether previous step was schema-less prompt or webhook resume.

---

## Component Configuration

**Default components at runner level:**

```typescript
import { BrainRunner } from '@positronic/core';
import { defaultComponents } from '@positronic/gen-ui-components';
import { EmailCard } from './components/email-card';

const runner = new BrainRunner({ client, adapters })
  .withResources(resources)
  .withPages(pages)
  .withComponents({
    ...defaultComponents,        // Form, Input, TextArea, Checkbox, etc.
    EmailCard,                   // Project-wide custom component
  });

await runner.run(emailDigestBrain, { initialState });
```

**Per-step override:**

```typescript
brain('email-digest')
  .ui('ShowDigest', digestPrompt, {
    components: {
      Input: MyCustomInput,           // Override default for this step
      EmailCard: EmailCardComponent,  // Use different EmailCard here
    },
    maxSteps: 20,                     // Override default max iterations
  })
```

**Resolution order**: step components → runner components → defaultComponents

---

## Example Usage

```typescript
const digestPrompt = prompt({
  template: ({ emails }) => `
    Present these ${emails.length} emails grouped by category.
    Let the user select which ones to archive.
  `,
  responseSchema: z.object({
    archiveIds: z.array(z.string()),
    note: z.string().optional(),
  }),
});

brain('email-digest')
  .step('Fetch', async ({ state }) => {
    const emails = await fetchEmails();
    return { ...state, emails };
  })

  .ui('ShowDigest', digestPrompt)

  .step('NotifyAndWait', ({ state, page }) => {
    // page.link: URL to the generated page
    // page.webhook: WebhookRegistration<Schema>

    sendNtfy(`Your digest is ready: ${page.link}`);

    return {
      state,
      waitFor: [page.webhook],
    };
  })

  .step('Archive', ({ state, response }) => {
    // response typed as { archiveIds: string[], note?: string }
    for (const id of response.archiveIds) {
      archiveEmail(id);
    }
    return { ...state, archived: response.archiveIds };
  })
```

---

## Agent Loop

**Architecture: `streamText` on client, `generateUI` in core**

Keep client interface simple - just thin wrappers around Vercel SDK methods. The `generateUI` logic lives in core.

**Update client interface:**

```typescript
// packages/core/src/clients/types.ts
interface ObjectGenerator {
  generateObject<T>(...): Promise<T>;

  // Multi-step tool calling with automatic tool execution
  streamText(params: {
    system?: string;
    prompt: string;
    messages?: ToolMessage[];  // Optional context messages
    tools: Record<string, {
      description: string;
      inputSchema: z.ZodSchema;
      execute?: (args: unknown) => Promise<unknown> | unknown;
    }>;
    maxSteps?: number;  // Default: 10
  }): Promise<{
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }>;
    text?: string;
    usage: { totalTokens: number };
  }>;
}
```

**Client implementations:**
- `client-vercel`: Thin wrapper around Vercel AI SDK's `streamText`
- `client-anthropic`: Implement equivalent using Anthropic API's tool use

**`generateUI` helper exported from core:**

```typescript
// packages/core/src/ui/generate-ui.ts
export async function generateUI(params: {
  client: ObjectGenerator;
  system: string;
  prompt: string;
  components: Record<string, UIComponent>;
  schema?: z.ZodSchema;
  maxSteps?: number;
}): Promise<{
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: unknown;
    result: unknown;
  }>;
}> {
  const tools = {
    ...componentsToTools(params.components),
    ValidateForm: createValidateFormTool(params.schema),
  };

  return client.streamText({
    system: `You generate UI pages using component tools.
      Use the ValidateForm tool to check your form matches the required schema.`,
    prompt: params.prompt,
    tools,
    maxSteps: params.maxSteps ?? 10,
  });
}
```

**Usage in UI step:**

```typescript
const result = await generateUI({
  client,
  system: frameworkSystemPrompt,
  prompt: promptText,  // User's prompt - includes schema requirements
  components: resolvedComponents,
  schema: prompt.responseSchema,
  maxSteps: options.maxSteps ?? 10,
});

// result.toolCalls contains all component placements
const page = renderToolCallsToPage(result.toolCalls, components);
```

**Loop behavior:**
- Agent calls component tools to build page structure
- Agent calls `ValidateForm` to check form matches schema
- Tool results fed back automatically by SDK/implementation
- Agent iterates until `ValidateForm` returns OK
- Max steps exceeded → throw error with context

**Future**: emit events per tool call

---

## Component System

**Component definition (tool + React component + metadata):**

```typescript
interface UIComponent {
  // React component for rendering
  component: React.ComponentType<any>;

  // Tool definition for LLM
  tool: {
    description: string;
    parameters: z.ZodSchema;
  };
}

const Input: UIComponent = {
  component: InputComponent,
  tool: {
    description: `A single-line text input field. Use for short text like names,
      emails, titles. For longer text, use TextArea instead.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data'),
      label: z.string().describe('Label displayed above the input'),
      placeholder: z.string().optional().describe('Placeholder text when empty'),
      required: z.boolean().optional().describe('Whether field is required'),
      type: z.enum(['text', 'email', 'number', 'password']).optional()
        .describe('Input type, defaults to text'),
    }),
  },
};

const Checkbox: UIComponent = {
  component: CheckboxComponent,
  tool: {
    description: `A checkbox for boolean yes/no choices. Returns true/false
      in form data. Use for single toggles, confirmations, opt-ins.`,
    parameters: z.object({
      name: z.string().describe('Form field name'),
      label: z.string().describe('Label displayed next to checkbox'),
      defaultChecked: z.boolean().optional(),
    }),
  },
};

const Container: UIComponent = {
  component: ContainerComponent,
  tool: {
    description: `A layout container that groups child components. Use to
      organize page sections, create visual hierarchy, add spacing.`,
    parameters: z.object({
      children: z.array(z.string()).describe('IDs of child components'),
      direction: z.enum(['row', 'column']).optional(),
      gap: z.enum(['none', 'small', 'medium', 'large']).optional(),
    }),
  },
};
```

**Default components exported from `@positronic/gen-ui-components`:**

```typescript
// packages/gen-ui-components/src/index.ts
export const defaultComponents: Record<string, UIComponent> = {
  Form,
  Input,
  TextArea,
  Checkbox,
  Select,
  MultiTextInput,
  Button,
  Text,
  Heading,
  Container,
};
```

**Tool generation from components:**

```typescript
function componentsToTools(components: Record<string, UIComponent>) {
  return Object.fromEntries(
    Object.entries(components).map(([name, comp]) => [
      name,
      {
        description: comp.tool.description,
        parameters: comp.tool.parameters,
        execute: async (params) => {
          // Record tool call, return component ID
          return { id: generateId(), component: name, props: params };
        },
      },
    ])
  );
}
```

**Page rendering:**
1. Components built with tsc
2. Bundled into base page template
3. Tool call results → `React.createElement()` tree
4. React renders client-side
5. Brain state embedded at generation time

---

## FormSchema Constraint

Prompts used with `.ui()` that have `responseSchema` must use form-compatible schemas:

```typescript
type FormPrimitive =
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodEnum<[string, ...string[]]>;

type FormField =
  | FormPrimitive
  | z.ZodOptional<FormPrimitive>
  | z.ZodArray<FormPrimitive>;

type FormSchema = z.ZodObject<{
  [key: string]: FormField
}>;
```

| Schema | Component |
|--------|-----------|
| `z.string()` | Input / TextArea |
| `z.number()` | Input (type="number") |
| `z.boolean()` | Checkbox |
| `z.enum([...])` | Select / radio buttons |
| `z.array(z.string())` | MultiTextInput |
| `z.array(z.enum([...]))` | Multi-select / checkbox group |

Form → JSON is mechanical, no LLM coercion needed.

**TypeScript enforcement:**

```typescript
// If prompt has responseSchema, it must satisfy FormSchema
ui<TPrompt extends Prompt<any>>(
  name: string,
  prompt: TPrompt extends { responseSchema: infer S }
    ? S extends FormSchema ? TPrompt : never
    : TPrompt,
  options?: { components?: ..., maxSteps?: number }
): ...
```

Runtime validation as backup.

---

## Page Lifecycle

- URL valid after `.ui()` step completes
- Page expiration controlled via PagesService options
- Form submission:
  - POST to webhook endpoint
  - Form data → JSON (mechanical)
  - Zod validates against schema
  - Webhook resolves with validated response
  - Page deleted

---

## Schema Communication to Agent

The **user's prompt** (from template) describes what the form should collect, including schema requirements. The framework's system prompt just instructs the agent on how to use tools.

A **`ValidateForm` tool** allows the agent to check if the current component tree produces data matching the schema:
- Agent builds form with component tools
- Agent calls `ValidateForm`
- Tool returns errors (missing fields, wrong types) or OK
- Agent iterates until valid

TBD: exact implementation of ValidateForm tool.

---

## Implementation Plan

Phased approach - each phase is a committable unit that keeps Positronic working.

---

### Phase 1: Client Infrastructure (no breaking changes)

**Step 1**: Add `streamText` to ObjectGenerator interface ✅
- Add `streamText` method to `ObjectGenerator` in core
- Define types for params and return value (maxSteps, messages, execute functions, usage)
- Existing code continues to work

**Step 2**: Implement `streamText` in `client-vercel` ✅
- Thin wrapper around Vercel AI SDK's `streamText`
- Handle `maxSteps` for multi-step (uses `stepCountIs()` internally)
- Write tests

**Step 3**: Implement `streamText` in `client-anthropic` ✅
- Implement equivalent using Anthropic API's tool use with iteration
- Match the same interface
- Write tests

---

### Phase 2: Component System (no breaking changes)

**Step 4**: Define `UIComponent` interface ✅
- Create interface combining React component + tool definition
- Export from core
- No runtime impact yet

**Step 5**: Build default components ✅
- Create React components: Form, Input, TextArea, Checkbox, Select, MultiTextInput, Button, Text, Heading, Container
- Add tool descriptions and parameter schemas
- Build with tsc
- Export `defaultComponents` from `@positronic/gen-ui-components` (separate package, not core)

**Step 6**: Add `.withComponents()` to BrainRunner ✅
- Additive method on BrainRunner
- Stores components for later use by `.ui()` steps
- No impact on existing brains

---

### Phase 3: Prompt Changes (modifies existing behavior)

**Step 7**: Make `responseSchema` optional in `prompt()` ✅
- Update prompt factory to allow omitting responseSchema
- Existing prompts with schemas continue to work unchanged

**Step 8**: Schema-less `.prompt()` returns ephemeral response ✅
- When no schema, prompt step returns text wrapped in object
- Text available as `response: { text: string }` in next step (ephemeral)
- Add type parameter handling

---

### Phase 4: UI Step (builds on everything above)

**Step 9**: Add `TPage` type parameter to Brain ✅
- New type parameter for ephemeral page
- Pattern matches existing `TResponse` handling

**Step 10**: Implement `generateUI` helper in core ✅
- Uses `client.streamText` internally
- Converts components to tools via `componentsToTools`
- Returns `placements` array with component IDs and props
- Exported from core

**Step 11**: Implement `ValidateForm` tool ✅
- Checks if current component tree satisfies schema
- Returns `{ valid: boolean, errors: string[] }`
- Uses shared placements array via closure to see current state
- Added when schema is provided to generateUI

**Step 12**: Add `.ui()` method to Brain
- Runs generateUI with components
- Creates page via PagesService
- Injects `page` into next step (ephemeral)
- TypeScript enforcement of FormSchema constraint

---

### Phase 5: Backend (can parallelize with Phase 4)

**Step 13**: Form submission webhook handler
- Handle POST from generated forms
- Form data → JSON (mechanical transform)
- Zod validate against schema
- Resolve webhook
- Delete page on successful submission

---

### Future Work (not blocking)

- [ ] Events per tool call during UI generation
- [ ] Logging service in spec package
- [ ] Implement logging in Cloudflare backend
- [ ] Update `px init` template to include `.withComponents(defaultComponents)` from `@positronic/gen-ui-components`
- [ ] Bundle components into base page template
- [ ] Tool call results → `React.createElement` rendering
