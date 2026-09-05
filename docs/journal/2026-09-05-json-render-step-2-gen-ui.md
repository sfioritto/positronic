# json-render step 2: gen-ui-components becomes catalog + browser runtime

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 43b64afd
**Plan:** `docs/json-render-plan.md` (step 2)
**Previous step:** `docs/journal/2026-09-05-json-render-step-1-core-spec.md`

## Goal

Replace the twelve hand-written Tailwind components in
`@positronic/gen-ui-components` with a catalog built on `@json-render/shadcn`
and a browser runtime that renders a json-render spec and posts the form back
to the brain. Core's server side (step 1) and the page-form webhook stay as
they are.

## Log

### 2026-09-05 — implementation

What we did: `@positronic/gen-ui-components/catalog` (server-safe) exports
`definitions`, `actions`, and the default `catalog`; the package root
(browser) exports `components` (React implementations), `mount(rootEl)`, and
the two Positronic components; `theme.css` carries the shadcn neutral tokens.
Sixteen shadcn definitions plus our `Checkbox` and `MultiTextInput`.

**The browser bundle must not import core's root.** The catalog needs
`definePageCatalog` from core, and the browser entry needs the catalog for
`defineRegistry`. Core's root pulls `node:` modules through the template
renderer, so bundling it for the browser would fail. Core now exports
`@positronic/core/page` (just `page/schema.ts`: json-render core and Zod
types), and gen-ui imports from there. The root Vitest config got an alias
for the subpath so tests resolve source.

**Checkbox groups as a single array binding.** The one form pattern shadcn
has no answer for is "pick some of these items" (a checkbox per repeated
row). Options were an `on.change` with `pushState`/`removeState` per box (a
lot to ask of the model), `$bindItem` writing into the seeded items plus a
smarter submit handler (couples the handler to page structure), or a
Checkbox that understands arrays. We took the last: shadcn's Checkbox
definition extended with a `value` prop; when `value` is set, the bound state
is an array and checking adds the value. The model writes what it would
naturally write (`checked: $bindState /form/selected`, `value: $item id`),
the submit handler stays dumb, and core's form check already treats a
boolean binding next to a `value` prop as yielding strings.

**Dropped `Hidden`.** The plan kept a hidden-input replacement for passing
IDs through the form. With `.page()` the brain's state survives the suspend,
and with the `generatePage` tool the model already has the data, so nothing
needs to round-trip through the form. It would also have broken the form
check (no `$bindState`), which was the hint it did not belong.

**Submit handler through `defineRegistry`.** json-render's action handlers
receive `(params, setState, state)` where `setState` is a React-style updater
and `state` comes from a getter, so `submitForm` reads `/formValidation`
*after* `validateForm` ran in the same press. That needs a controlled
`StateStore` (`createStateStore(spec.state)`) and a ten-line bridge that
applies the updater's result to the store one top-level key at a time. The
alternative (plain `handlers` on `JSONUIProvider`) never sees state.

**Form encoding.** `toFormData` mirrors a native post so `parseFormData` on
the server sees the same shape: arrays append per item, `true` posts as
`"true"`, and `false`/`null`/`undefined` are omitted like an unchecked box.
Booleans arriving as `"true"` or absent is what the old HTML form did too.

**Confirmation without model involvement.** The runtime wraps the Renderer:
when `/submitted` flips true it shows "Submitted"; `/submitError` renders
under the form. The model never has to know those paths exist.

**Only the browser knows the form action**, so `mount()` builds the registry
(it closes `createSubmitForm(page.formAction)` into the action). Projects
that add components pass `{ catalog, components }` to `mount`.

**jsdom test was worth it.** Root gets `jsdom` as a dev dependency; the
mount test drives the whole path (type into a bound input, tick one of two
repeated checkboxes, press the submit button, assert the `FormData` and the
confirmation). It passed first run, which is the best evidence the
validate-then-submit ordering works. React controlled inputs need the
prototype `value` setter trick so the change registers.

**Styling.** `@json-render/shadcn` ships no CSS and does not export its
`ui/*` primitives, so our two components use plain elements with the same
utility classes. Tailwind classes are generated at project build time (step
3) by `@source`-ing the shadcn dist and gen-ui dist. `theme.css` is the
shadcn v4 neutral palette with `@theme inline` and the `@layer base` reset;
overlay components and `tw-animate-css` were left out.

**Bundle size, measured early.** A trial esbuild of `mount()` (iife, minified,
browser platform) comes out at 991 KB, 265 KB gzipped, with no bare
`require()` calls. The bulk is `@json-render/shadcn`: its index exports one
`shadcnComponents` object holding all 36 implementations, so importing our
16 still ships Radix, embla-carousel, vaul, and lucide for the other 20.
Served once per page load from R2, so acceptable for now; if it matters,
the fix is to implement the subset ourselves or get per-component exports
upstream.

## Learnings

- json-render action handlers are the right place for the submit: they get
  live state after preceding actions in the same binding array.
- `@json-render/shadcn` definitions are plain objects with Zod props; they
  drop straight into `definePageCatalog`, and `.extend()` on a definition's
  props is the way to add a prop without re-declaring the component.
- A package with both server and browser entries needs to watch what each
  entry transitively imports; core's `node:` imports were one `import` away.

## Dead ends

None.
