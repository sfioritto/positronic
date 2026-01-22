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
import { components } from '@positronic/gen-ui-components';
import { EmailCard } from './components/email-card';

const runner = new BrainRunner({ client, adapters })
  .withResources(resources)
  .withPages(pages)
  .withComponents({
    ...components,               // Form, Input, TextArea, Checkbox, etc. (bundle attached)
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

**Resolution order**: step components → runner components → default components

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

Keep client interface simple - just thin wrappers around Vercel SDK methods. The `generateUI` logic lives in core. Core has no React runtime dependency.

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

**Placement structure (component tree as data):**

```typescript
// packages/core/src/ui/types.ts
interface Placement {
  id: string;
  component: string;          // Component name, e.g., "Form", "Checkbox"
  props: Record<string, unknown>;  // Props with binding syntax preserved
  parentId: string | null;    // Parent placement ID, null for root
}
```

**Tree structure via `parentId`:**

Components specify their parent when placed. The LLM receives the parent's ID from the previous tool call result and uses it in the next call. This builds a flat array that represents a tree:

```typescript
// Tool execution returns the placement ID
execute: (props) => {
  const id = generateId();
  placements.push({ id, component: name, props, parentId: props.parentId ?? null });
  return { id, component: name };  // LLM sees this ID and can use it as parentId
}

// Example placements array (flat, but represents tree via parentId):
[
  { id: "form-1", component: "Form", props: {}, parentId: null },
  { id: "input-1", component: "Input", props: { name: "email", parentId: "form-1" }, parentId: "form-1" },
  { id: "input-2", component: "Input", props: { name: "name", parentId: "form-1" }, parentId: "form-1" },
]
```

**Data binding syntax:**

Props can contain binding expressions using `{{path}}` syntax. These are preserved in placements and resolved at render time:

```typescript
// In placement props (stored as-is):
{ title: "{{email.subject}}", items: "{{emails}}" }

// At render time, bootstrap runtime resolves against data:
function resolveProp(value, data) {
  if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
    const path = value.slice(2, -2).trim();
    return path.split('.').reduce((obj, key) => obj?.[key], data);
  }
  return value;
}
```

Loop components (like `List`) create local scope for their items:
- `List` with `items: "{{emails}}"` and `as: "email"`
- Children can reference `{{email.subject}}`, `{{email.id}}`, etc.
- The bootstrap runtime handles this by passing the loop item as additional context

**`generateUI` helper exported from core:**

```typescript
// packages/core/src/ui/generate-ui.ts
export async function generateUI(params: {
  client: ObjectGenerator;
  prompt: string;
  components: Record<string, ComponentToolDefinition>;
  schema?: z.ZodSchema;
  data: Record<string, unknown>;  // For data binding validation
  maxSteps?: number;
}): Promise<{
  placements: Placement[];
  rootId: string;
}> {
  const placements: Placement[] = [];

  const tools = {
    ...componentsToTools(params.components, placements),
    ValidateForm: createValidateFormTool(params.schema, params.data, placements),
  };

  await client.streamText({
    system: buildSystemPrompt(params.components),
    prompt: params.prompt,
    tools,
    maxSteps: params.maxSteps ?? 10,
  });

  const rootId = placements.find(p => p.parentId === null)?.id;
  return { placements, rootId };
}
```

**Usage in UI step:**

```typescript
const result = await generateUI({
  client,
  prompt: promptText,
  components: resolvedComponents,
  schema: prompt.responseSchema,
  data: state,  // Brain state for data binding validation
  maxSteps: options.maxSteps ?? 10,
});

// result.placements is the component tree as JSON data
// Passed to page template generator (no React needed here)
const page = await pagesService.createPage({
  placements: result.placements,
  rootId: result.rootId,
  data: state,
  schema: prompt.responseSchema,
});
```

**Loop behavior:**
- Agent calls component tools to build page structure
- Each tool call adds a Placement to the shared array
- Agent calls `ValidateForm` to check form matches schema
- Tool results fed back automatically by SDK/implementation
- Agent iterates until `ValidateForm` returns OK
- Max steps exceeded → throw error with context

**Future**: emit events per tool call

---

## Component System

**Separation of concerns:**

Core needs only tool metadata (no React dependency). React components live in `gen-ui-components` and are bundled separately for client-side rendering.

**Tool definition in core (no React):**

```typescript
// packages/core/src/ui/types.ts
interface ComponentToolDefinition {
  description: string;
  parameters: z.ZodSchema;
}

// Example tool definitions
const InputTool: ComponentToolDefinition = {
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
};

const CheckboxTool: ComponentToolDefinition = {
  description: `A checkbox for boolean yes/no choices. Returns true/false
    in form data. Use for single toggles, confirmations, opt-ins.`,
  parameters: z.object({
    name: z.string().describe('Form field name'),
    label: z.string().describe('Label displayed next to checkbox'),
    value: z.string().optional().describe('Value submitted when checked'),
    defaultChecked: z.boolean().optional(),
  }),
};
```

**React components in gen-ui-components:**

Components use Tailwind utility classes for styling (Tailwind loaded via CDN at runtime):

```typescript
// packages/gen-ui-components/src/components/Input.tsx
export function Input({ name, label, placeholder, required, type = 'text' }) {
  return (
    <div className="mb-4">
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}
```

**Package exports from `@positronic/gen-ui-components`:**

```typescript
// packages/gen-ui-components/src/index.ts
import { createComponentRegistry } from '@positronic/core';

// Unified export: components with attached bundle
// The bundle is attached via a Symbol key, so spread operations preserve it
export const components = createComponentRegistry(
  { Form, Input, TextArea, Checkbox, Select, ... },
  componentBundle
);

// React components are also pre-bundled into dist/components.js for client-side use
```

**Tool generation from definitions:**

```typescript
// packages/core/src/ui/generate-ui.ts
function componentsToTools(
  components: Record<string, ComponentToolDefinition>,
  placements: Placement[]
) {
  return Object.fromEntries(
    Object.entries(components).map(([name, def]) => [
      name,
      {
        description: def.description,
        parameters: def.parameters,
        execute: async (params) => {
          const id = generateId();
          placements.push({ id, component: name, props: params, parentId: null });
          return { id, component: name };
        },
      },
    ])
  );
}
```

**Page rendering (client-side with React from CDN):**

1. Components built with SWC, bundled with esbuild (React as external)
2. `generateUI` returns placements array (component tree as JSON)
3. Page template generated with:
   - React/ReactDOM from CDN (`<script>` tags)
   - Tailwind CSS from CDN (`<script src="https://cdn.tailwindcss.com">`)
   - Component bundle inlined (`<script>` with bundle contents)
   - Placements JSON embedded (`window.__POSITRONIC_TREE__`)
   - Runtime data embedded (`window.__POSITRONIC_DATA__`)
   - Bootstrap script that resolves bindings and renders
4. React renders entirely client-side
5. No React dependency in core at runtime
6. Components use Tailwind classes for styling - no separate CSS bundle needed

**Page template structure:**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>

  <!-- Pre-bundled components (inlined) -->
  <script>/* contents of gen-ui-components/dist/components.js */</script>

  <!-- Data injected at generation time -->
  <script>
    window.__POSITRONIC_DATA__ = { /* brain state */ };
    window.__POSITRONIC_TREE__ = [ /* placements array */ ];
    window.__POSITRONIC_ROOT__ = "placement-id";
  </script>

  <!-- Bootstrap runtime -->
  <script>/* runtime that builds and renders React tree */</script>
</body>
</html>
```

**Bootstrap runtime (inlined in page):**

```javascript
(function() {
  const components = window.PositronicComponents;
  const data = window.__POSITRONIC_DATA__;
  const tree = window.__POSITRONIC_TREE__;
  const rootId = window.__POSITRONIC_ROOT__;

  function resolveBinding(path, ctx) {
    return path.split('.').reduce((o, k) => o?.[k], ctx);
  }

  function resolveProp(value, ctx) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      return resolveBinding(value.slice(2, -2).trim(), ctx);
    }
    return value;
  }

  function buildElement(placementId, ctx) {
    const placement = tree.find(p => p.id === placementId);
    const Component = components[placement.component];

    // Resolve props
    const props = {};
    for (const [key, value] of Object.entries(placement.props)) {
      props[key] = resolveProp(value, ctx);
    }

    // Find children
    const childIds = tree.filter(p => p.parentId === placementId).map(p => p.id);
    const children = childIds.map(id => buildElement(id, ctx));

    return React.createElement(Component, props, ...children);
  }

  ReactDOM.render(
    buildElement(rootId, data),
    document.getElementById('root')
  );
})();
```

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

The **user's prompt** (from template) describes what the form should collect, including schema requirements. The framework's system prompt instructs the agent on how to use tools.

**`ValidateForm` tool implementation:**

The tool validates two things:
1. Form fields will produce data matching the expected Zod schema
2. All data bindings (`{{path}}`) reference valid paths in the provided data

```typescript
// packages/core/src/ui/validate-form.ts
function createValidateFormTool(
  schema: ZodType | undefined,
  data: Record<string, unknown>,
  placements: Placement[]
) {
  const dataType = inferDataType(data);

  return {
    description: `Validate the current form structure. Checks that:
      1. Form fields will produce data matching the expected schema
      2. All data bindings reference valid paths in the provided data
      Call this after building your form to verify it's correct.`,
    parameters: z.object({}),  // No input - reads current placements
    execute: async () => {
      const errors: ValidationError[] = [];

      // 1. Extract form schema from placements
      const extracted = extractFormSchema(placements);

      // 2. Validate against expected Zod schema (if provided)
      if (schema) {
        const schemaResult = validateAgainstZod(extracted, schema);
        errors.push(...schemaResult.errors);
      }

      // 3. Validate all data bindings
      const bindingResult = validateDataBindings(placements, dataType);
      errors.push(...bindingResult.errors);

      return {
        valid: errors.length === 0,
        errors: errors.map(e => ({ type: e.type, message: e.message })),
        extractedFields: extracted.fields.map(f => ({
          name: f.name,
          type: f.type,
        })),
      };
    },
  };
}
```

**Form schema extraction:**

```typescript
// Walks placements, finds form input components, extracts field info
function extractFormSchema(placements: Placement[]): ExtractedFormSchema {
  const fields: FormField[] = [];

  for (const placement of placements) {
    const formComponent = FORM_COMPONENTS[placement.component];
    if (formComponent) {
      const name = placement.props[formComponent.nameProp];
      if (typeof name === 'string') {
        fields.push({
          name,
          type: formComponent.fieldType,
          insideLoop: isInsideLoop(placement, placements),
        });
      }
    }
  }

  return { fields };
}

// Maps component names to their form field behavior
const FORM_COMPONENTS = {
  TextInput: { nameProp: 'name', fieldType: 'string' },
  NumberInput: { nameProp: 'name', fieldType: 'number' },
  Checkbox: { nameProp: 'name', fieldType: 'boolean' },
  Select: { nameProp: 'name', fieldType: 'string' },
  HiddenInput: { nameProp: 'name', fieldType: 'string' },
  TextArea: { nameProp: 'name', fieldType: 'string' },
};
```

**Data binding validation:**

```typescript
// Validates that all {{path}} bindings reference valid data paths
function validateDataBindings(
  placements: Placement[],
  dataType: DataType
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const placement of placements) {
    for (const [propName, propValue] of Object.entries(placement.props)) {
      if (isBinding(propValue)) {
        const path = extractBindingPath(propValue);
        const resolved = resolvePathType(path, dataType, getLoopContext(placement));

        if (resolved === null) {
          errors.push({
            type: 'invalid-binding',
            message: `Invalid binding "{{${path}}}" - path does not exist in data`,
            path: `${placement.component}.${propName}`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**Loop behavior:**
- Agent builds form with component tools
- Agent calls `ValidateForm`
- Tool returns errors (missing fields, wrong types, invalid bindings) or OK
- Agent iterates until valid

---

## Package Structure

**`@positronic/core`** - No React dependency

```
dependencies: zod
devDependencies: (build tools)

exports:
  - ComponentToolDefinition interface
  - generateUI helper
  - generatePageHtml (page template generator)
  - ValidateForm tool factory
  - extractFormSchema, validateDataBindings utilities
```

**`@positronic/gen-ui-components`** - React as dev dependency only

```
devDependencies: react, react-dom, esbuild, @swc/core
peerDependencies: (none - components are bundled)

exports:
  - defaultComponentTools: Record<string, ComponentToolDefinition>
  - dist/components.js (pre-bundled, React external, IIFE)
  - (no CSS - components use Tailwind classes, loaded via CDN at runtime)

build:
  1. tsc (type declarations only)
  2. swc src -d dist/src (transpile TypeScript to JS)
  3. esbuild src/bundle.ts --bundle --external:react --external:react-dom \
       --format=iife --global-name=PositronicComponents --outfile=dist/components.js
```

**Bundle entry point:**

```typescript
// packages/gen-ui-components/src/bundle.ts
import { Form, Input, TextArea, Checkbox, Select, List, ... } from './components';

// Expose to window for client-side rendering
(window as any).PositronicComponents = {
  Form,
  Input,
  TextArea,
  Checkbox,
  Select,
  List,
  Section,
  Card,
  Text,
  Button,
  HiddenInput,
  SubmitButton,
};
```

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

**Step 4**: Define `ComponentToolDefinition` interface ✅
- Create interface for tool metadata only (no React dependency)
- Export from core
- No runtime impact yet

**Step 5**: Build default components ✅
- Create React components: Form, Input, TextArea, Checkbox, Select, List, Button, Text, Heading, Section, Card
- Add tool descriptions and parameter schemas as separate `ComponentToolDefinition` objects
- Export tool definitions from `@positronic/gen-ui-components`

**Step 5b**: Bundle components with esbuild
- Add esbuild as devDependency to `gen-ui-components`
- Create bundle entry point (`src/bundle.ts`) that exposes React components to `window.PositronicComponents`
- Configure esbuild: React as external, IIFE format, single output file
- Build produces `dist/components.js` (no CSS - components use Tailwind classes via CDN)
- Add build script: `esbuild src/bundle.ts --bundle --external:react --external:react-dom --format=iife --global-name=PositronicComponents --outfile=dist/components.js`
- Components should use Tailwind utility classes for styling

**Step 6**: Add `.withComponents()` to BrainRunner ✅
- Additive method on BrainRunner
- Stores component tool definitions for later use by `.ui()` steps
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
- Validates data bindings against provided data type
- Returns `{ valid: boolean, errors: ValidationError[] }`
- Uses shared placements array via closure to see current state
- Added when schema is provided to generateUI

**Step 11b**: Implement data binding validation
- `inferDataType`: Infer type structure from sample data
- `validateDataBindings`: Check all `{{path}}` bindings resolve to valid paths
- Handle loop context (e.g., `{{item.field}}` inside a List)
- Return detailed errors for invalid bindings

**Step 11c**: Implement form schema extraction
- `extractFormSchema`: Walk placements, find form inputs, extract field info
- `validateAgainstZod`: Check extracted fields match expected Zod schema
- Handle fields inside loops (become arrays)

**Step 12**: Implement page template generator
- Create `generatePageHtml` function in core
- Inputs: placements, rootId, data, component bundle, styles
- Inlines React from CDN, component bundle, data as JSON, bootstrap runtime
- Returns complete HTML string
- No React runtime dependency (just string concatenation)

**Step 13**: Add `.ui()` method to Brain
- Runs generateUI with components
- Calls page template generator
- Creates page via PagesService (stores HTML)
- Injects `page` into next step (ephemeral)
- TypeScript enforcement of FormSchema constraint

---

### Phase 5: Backend (can parallelize with Phase 4)

**Step 14**: Form submission webhook handler
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
- [ ] Update `px init` template to include component setup
- [ ] Custom component authoring guide (how users add their own components)
