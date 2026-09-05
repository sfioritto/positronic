# json-render step 1: core generates a json-render Spec

**Status:** active
**Started:** 2026-09-05
**Plan:** `docs/json-render-plan.md` (step 1)
**Evaluation:** `docs/journal/2026-09-04-json-render-evaluation.md`

## Goal

Replace the YAML page generator (`core/src/yaml/`, `core/src/ui/`) with one
built on `@json-render/core`: the model emits JSONL patches, core compiles
them into a json-render `Spec`, seeds the spec's state from the step's
`props`, validates, repairs, and embeds the spec in a page that the project's
component bundle renders. The server side of forms does not change.

## Log

### 2026-09-05 — implementation

What we did: `core/src/page/` replaces `yaml/` and `ui/`. `pageSchema` +
`definePageCatalog()` define the spec shape and prompt; `generateSpec()` runs
the generate/validate/repair loop; `checkFormSchema()` ports the form check;
`generatePageHtml()` embeds the spec for the bundle. `withComponents` →
`withCatalog`, `createBrain({ catalog })`, `StepContext.catalog`.

**json-render's default prompt fights our state model, so core owns the
prompt.** The plan had gen-ui define the schema with Positronic
`defaultRules`. Probing `catalog.prompt()` showed the default *template* (not
just the rules) tells the model three separate times to invent realistic
sample data and stream `/state` patches. Rules appended at the end cannot
undo that. `defineSchema` takes a `promptTemplate`, so core now has its own
(~140 lines, borrowing json-render's sections for repeat, dynamic props,
visibility, events, validation) with a STATE section that says the host seeds
state and a FORMS section that spells out `/form/<field>` bindings and the
`validateForm` → `submitForm` button. Consequence: the schema lives in core,
gen-ui only supplies components and the `submitForm` action, projects call
`definePageCatalog({ components, actions })`. Step 2 of the plan shrinks
accordingly.

**`catalog.validate()` only catches unknown component names.** A probe with
`gap: 'x'` on a number prop and a missing required `label` passed. Props are
effectively unvalidated by json-render, presumably because any prop may be a
dynamic expression. So the form check reads the *type* of a bound prop from
the catalog's own Zod schema (`Checkbox.checked` is boolean, `Input.value`
is string, `MultiTextInput.value` is string[]) instead of a component-name
table like the old `FORM_COMPONENTS` map. The only Positronic-specific rules
are: a boolean binding next to a `value` prop is a checkbox-group entry and
yields the value; anything inside a `repeat` yields an array.

**Number fields must accept text inputs.** The `page-form` webhook never runs
the form schema through Zod; `parseFormData` returns strings and
`coerceFormResponse` only fixes arrays. A `z.number()` field has always
arrived as a string. If the form check demanded a number-yielding component
the model could never satisfy it (no such component exists), so the check
treats string as satisfying number. Pre-existing gap, now written down.

**`compileSpecStream` never throws.** A `remove` on a missing path is
ignored; a `replace` on a missing path creates a partial element
(`{ props: {} }` with no `type`). No try/catch needed around it; the partial
element is caught by `catalog.validate` (`type` is not a known component).
Prose and code fences around the JSONL are skipped too, so no fence
stripping.

**Repair loop details.** Repairs use json-render's `patch` edit mode:
`buildUserPrompt({ prompt: issues, currentSpec, editModes: ['patch'] })`
wraps the current spec as "CURRENT UI STATE" and asks for patch lines only,
which go through the same `compileSpecStream` as generation. The spec goes
back *without* `state`: the seeded props would otherwise leak real values
into the prompt and, for a 200-email inbox, blow it up. State is re-seeded
after every compile, props winning. `autoFixSpec({ lossy })` prunes dangling
children only on the last round, per json-render's own guidance ("prefer
re-prompting over accepting lossy fixes"). Tests cover both the pruning path
and the unfixable path (unknown component → throw after N rounds).

**One-shot text through `streamText`.** `ObjectGenerator.generateText` is
optional and the Vercel client defaults `toolChoice` to `'required'`, so the
generator calls the required `streamText` with `tools: {}`, `maxSteps: 1`,
`toolChoice: 'none'`. Existing mocks (`mockStreamText`) carry over.

**Small deletions the plan said to keep.** `FormSchema`, `FormField`,
`isFormSchema` in `ui/types.ts` had no callers (`.page()` types its schema as
`z.ZodObject<any>`), so they went with the file. `yaml` left core's
dependencies; `@types/react` stays because `jsx-runtime.ts` imports React's
`JSX` namespace type.

**Keeping step 1 green on its own.** `@positronic/gen-ui-components` imported
`UIComponent` from core. Rather than break its build until step 2, the type
moved into `gen-ui-components/src/types.ts` (twelve import-path edits). Step
2 deletes it with the rest of the package's `src/components/`.

**Skipped:** the 20-line `$state` path walker from the plan. `validateSpec`'s
`repeat_state_mismatch` already covers arrays once state is seeded, and
`/form/*`, `/formValidation`, `/submitted` are runtime paths that would need
an allowlist. Add it if bad `$state` paths show up in practice.

## Learnings

- Read json-render's *generated* prompt before deciding where rules go; the
  template carries opinions the docs don't mention.
- `catalog.validate` is not a props validator. Anything we care about in
  props we check ourselves.
- json-render's `Spec` is an interface without an index signature, so
  `compileSpecStream(text, spec)` needs a spread or cast.

## Dead ends

None yet.
