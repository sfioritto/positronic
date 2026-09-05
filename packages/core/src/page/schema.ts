import {
  buildEditInstructions,
  defineCatalog,
  defineSchema,
  type PromptContext,
} from '@json-render/core';
import type { z } from 'zod';

/**
 * A component the page generator may place. `props` is the Zod schema the
 * model sees (and that the browser registry renders with); `description`
 * tells the model when to use it.
 */
export interface PageComponentDefinition {
  props: z.ZodType;
  description: string;
  /** `['default']` accepts children; other names declare named slots. */
  slots?: string[];
  /** Event names the component emits, bound with the element's `on` field. */
  events?: string[];
  /** Example props for the prompt (derived from the schema when omitted). */
  example?: unknown;
}

/**
 * An action the browser runtime handles when an element's `on` binding fires.
 */
export interface PageActionDefinition {
  params?: z.ZodType;
  description: string;
}

export interface PageCatalogData {
  components: Record<string, PageComponentDefinition>;
  actions?: Record<string, PageActionDefinition>;
}

/**
 * Actions handled by the json-render runtime itself. Only the ones a
 * Positronic page needs are advertised to the model.
 */
const builtInActions = [
  {
    name: 'setState',
    description:
      'Update a value in the state model. Params: { statePath: string, value: any }',
  },
  {
    name: 'validateForm',
    description:
      'Validate every form field on the page and write { valid, errors } to /formValidation. Params: none.',
  },
];

const baseRules = [
  'Output ONLY JSONL patches: one JSON object per line, no markdown, no code fences, no prose.',
  'First set root: {"op":"add","path":"/root","value":"<root-key>"}',
  'Then add each element: {"op":"add","path":"/elements/<key>","value":{...}}',
  'ONLY use components from AVAILABLE COMPONENTS.',
  'Every element value needs type, props, and children (an array of child keys; [] for leaves). Every key in a children array must be added as its own element.',
  'Use unique, descriptive element keys (e.g. "header", "email-list", "submit").',
  '"visible", "on", "repeat", and "watch" are top-level element fields, never inside props.',
  'Text content is plain text: no markdown (**bold**, [links](url)) inside strings.',
];

function promptTemplate({
  catalog,
  componentNames,
  actionNames,
  options,
  formatZodType,
}: PromptContext<PageCatalogData>): string {
  const [container = 'Container', leaf = 'Text'] = componentNames;
  const lines: string[] = [];

  lines.push(options.system ?? 'You are a UI generator that outputs JSON.', '');

  lines.push(
    'OUTPUT FORMAT (JSONL, RFC 6902 JSON Patch):',
    'Output one JSON object per line. Each line is a JSON Patch operation (add, remove, replace) that builds a UI spec with a /root key and a flat /elements map. Set /root first, then add each element.',
    '',
    'Example output (each line is a separate JSON object):',
    JSON.stringify({ op: 'add', path: '/root', value: 'main' }),
    JSON.stringify({
      op: 'add',
      path: '/elements/main',
      value: { type: container, props: {}, children: ['title', 'list'] },
    }),
    JSON.stringify({
      op: 'add',
      path: '/elements/title',
      value: { type: leaf, props: {}, children: [] },
    }),
    JSON.stringify({
      op: 'add',
      path: '/elements/list',
      value: {
        type: container,
        props: {},
        repeat: { statePath: '/items', key: 'id' },
        children: ['item'],
      },
    }),
    JSON.stringify({
      op: 'add',
      path: '/elements/item',
      value: {
        type: leaf,
        props: { text: { $item: 'title' } },
        children: [],
      },
    }),
    ''
  );

  lines.push(
    'STATE:',
    'The host seeds the state model before the page renders. The user message describes that data under "## State" as a TypeScript-like shape. Read it with { "$state": "/path" } and render arrays with "repeat". Never emit /state patches for seeded paths and never invent sample data: the real values are present at render time.',
    'State paths are RFC 6901 JSON Pointers ("/emails/0/subject"), never dot notation.',
    ''
  );

  lines.push(
    'FORMS:',
    'When the user message lists fields under "## Form", the page collects exactly those fields. For each field use an input component whose "name" prop is the field name and whose value prop (value, checked, ...) is { "$bindState": "/form/<field>" }. Bind nothing else under /form.',
    'To let the user pick several items from a seeded array, place a Checkbox inside the repeated element with "checked": { "$bindState": "/form/<field>" } and "value": { "$item": "<idField>" }; every checked value is collected into an array at /form/<field>.'
  );
  if (actionNames.includes('submitForm')) {
    lines.push(
      'End the form with a Button whose on.press runs validateForm and then submitForm: "on": { "press": [{ "action": "validateForm" }, { "action": "submitForm" }] }. Pages without form fields have no submit button.'
    );
  }
  lines.push('');

  lines.push(
    'DYNAMIC LISTS (repeat):',
    'Any element can have a top-level "repeat" field to render its children once per item of a state array: { "repeat": { "statePath": "/emails", "key": "id" } }. The element itself renders once as the container; its children are expanded per item. Inside those children use { "$item": "field" } to read a field of the current item and { "$index": true } for the index. For an array stored on the item use { "statePath": { "$item": "field" } }.',
    'ALWAYS use repeat for lists backed by state arrays; NEVER hardcode one element per item.',
    ''
  );

  lines.push(
    'DYNAMIC PROPS:',
    'Any prop value can be an expression resolved against state:',
    '1. Read: { "$state": "/path" } resolves to the value at that path.',
    '2. Two-way binding: { "$bindState": "/form/email" } reads the value and writes user edits back. Use it on input props (value, checked, pressed). Inside repeat scopes { "$bindItem": "field" } binds to the current item.',
    '3. Conditional: { "$cond": <condition>, "$then": <value>, "$else": <value> } picks a value using the visibility condition syntax.',
    '4. Template: { "$template": "Hello ${/user/name}" } interpolates state paths; bare names like ${title} resolve against the current repeat item first.',
    ''
  );

  lines.push(
    'VISIBILITY:',
    'An element can have a top-level "visible" condition: { "$state": "/path" } (truthy), with one optional operator eq, neq, gt, gte, lt, lte, and "not": true to invert. Inside repeat use { "$item": "field", "eq": "x" }. Arrays of conditions AND together; { "$or": [...] } ORs. true/false always show/hide.',
    ''
  );

  lines.push(
    'EVENTS (the `on` field):',
    'An element can have a top-level "on" field mapping an event name (from the component\'s events) to an action binding { "action": "<name>", "params": { ... } } or an array of bindings run in order. Params accept { "$state": "/path" }. Never put actions inside props.',
    ''
  );

  const components = Object.entries(catalog.components);
  const hasChecks = components.some(([, def]) =>
    formatZodType(def.props).includes('checks')
  );
  if (hasChecks) {
    lines.push(
      'VALIDATION:',
      'Inputs with a "checks" prop validate client-side. Each check is { "type": "<name>", "message": "...", "args": { ... } }. Types: required, email, minLength (args.min), maxLength (args.max), pattern (args.pattern), min, max, numeric, url, matches (args.other: { "$state": "/path" }), requiredIf (args.field). Give required form fields a required check; validateForm blocks submission while any check fails.',
      ''
    );
  }

  lines.push(`AVAILABLE COMPONENTS (${components.length}):`, '');
  for (const [name, def] of components) {
    const slots = def.slots ?? [];
    const notes = [
      slots.includes('default') ? 'accepts children' : '',
      slots.filter((slot) => slot !== 'default').length > 0
        ? `slots: ${slots.filter((slot) => slot !== 'default').join(', ')}`
        : '',
      def.events && def.events.length > 0
        ? `events: ${def.events.join(', ')}`
        : '',
    ].filter(Boolean);
    const suffix = notes.length > 0 ? ` [${notes.join('; ')}]` : '';
    lines.push(
      `- ${name}: ${formatZodType(def.props)} - ${def.description}${suffix}`
    );
  }
  lines.push('');

  lines.push('AVAILABLE ACTIONS:', '');
  for (const action of builtInActions) {
    lines.push(`- ${action.name}: ${action.description} [built-in]`);
  }
  for (const [name, def] of Object.entries(catalog.actions ?? {})) {
    lines.push(`- ${name}: ${def.description}`);
  }
  lines.push('');

  if (options.editModes && options.editModes.length > 0) {
    lines.push(buildEditInstructions({ modes: options.editModes }, 'json'));
  }

  lines.push('RULES:');
  [...baseRules, ...(options.customRules ?? [])].forEach((rule, index) => {
    lines.push(`${index + 1}. ${rule}`);
  });

  return lines.join('\n');
}

/**
 * The json-render schema for Positronic pages: the spec shape the model
 * emits, what a catalog must provide, and the prompt that ties them to the
 * host's contract (state seeded from `props`, fields bound under `/form/`).
 */
export const pageSchema = defineSchema(
  (s) => ({
    spec: s.object({
      root: s.string(),
      elements: s.record(
        s.object({
          type: s.ref('catalog.components'),
          props: s.propsOf('catalog.components'),
          children: s.array(s.string()),
          slots: { ...s.record(s.array(s.string())), ...s.optional() },
          visible: { ...s.any(), ...s.optional() },
          repeat: { ...s.any(), ...s.optional() },
          on: { ...s.any(), ...s.optional() },
        })
      ),
      state: { ...s.any(), ...s.optional() },
    }),
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        events: s.array(s.string()),
        description: s.string(),
        example: s.any(),
      }),
      actions: s.map({
        params: s.zod(),
        description: s.string(),
      }),
    }),
  }),
  {
    builtInActions,
    promptTemplate: promptTemplate as (context: PromptContext) => string,
  }
);

/**
 * Build the catalog a brain renders pages with. Projects call this with the
 * component and action definitions from `@positronic/gen-ui-components`,
 * adding their own components alongside.
 */
export function definePageCatalog({
  components,
  actions = {},
}: PageCatalogData) {
  return defineCatalog(pageSchema, { components, actions });
}

export type PageCatalog = ReturnType<typeof definePageCatalog>;
