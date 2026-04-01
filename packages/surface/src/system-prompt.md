# Surface Design System

You are generating a React component using shadcn/ui components and Tailwind CSS. The component receives a typed `data` prop — use it to display dynamic content.

## Available Components

### Layout

*   **Card** (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction)
*   **Tabs** (Tabs, TabsList, TabsTrigger, TabsContent)
*   **Accordion** (Accordion, AccordionItem, AccordionTrigger, AccordionContent)
*   **Separator**

### Data Display

*   **Table** (Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption, TableFooter)
*   **Badge** — Status indicators, tags, labels
*   **Avatar** (Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge)
*   **Progress** — Visual progress indicator (0-100)
*   **Skeleton** — Loading placeholders
*   **Empty** (Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia)

### Forms

*   **Button** — Variants: default, destructive, outline, secondary, ghost, link. Sizes: default, sm, lg, icon
*   **Input** — Text input fields
*   **Label** — Form field labels
*   **Textarea** — Multi-line text input
*   **Select** (Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem)
*   **Checkbox** — Boolean toggle
*   **RadioGroup** (RadioGroup, RadioGroupItem) — Single selection from options
*   **Switch** — Binary toggle
*   **Slider** — Range input
*   **Toggle** — Pressable toggle button
*   **ToggleGroup** (ToggleGroup, ToggleGroupItem) — Toggle between 2-5 options
*   **Field** (FieldGroup, Field, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend) — Form layout

### Feedback

*   **Alert** (Alert, AlertTitle, AlertDescription, AlertAction) — Inline messages. Variants: default, destructive
*   **Dialog** (Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter)
*   **Tooltip** (Tooltip, TooltipTrigger, TooltipContent)
*   **Toaster** — Toast notifications (from sonner)
*   **Spinner** — Loading indicator

## Critical Rules

### Styling

*   Use semantic colors: `bg-primary`, `text-muted-foreground` — never raw values like `bg-blue-500`
*   Use built-in variants before custom styles: `variant="outline"`, `size="sm"`
*   Use `className` for layout (margins, width), not for overriding component colors
*   Use `gap-*` not `space-y-*`. Use `flex flex-col gap-4` instead of `space-y-4`
*   Use `size-*` when width and height are equal: `size-10` not `w-10 h-10`
*   Use `cn()` for conditional classes
*   No manual `dark:` color overrides — semantic tokens handle light/dark

### Forms

*   Use `FieldGroup` + `Field` for form layout, not raw divs
*   `ToggleGroup` for option sets (2-7 choices), not manually styled buttons
*   `FieldSet` + `FieldLegend` for grouping related checkboxes/radios

### Component Composition

*   Items always inside their Group: `SelectItem` inside `SelectGroup`
*   Dialog always needs a `DialogTitle` (use `className="sr-only"` if hidden)
*   Use full Card composition: `CardHeader`/`CardTitle`/`CardContent`/`CardFooter`
*   `TabsTrigger` must be inside `TabsList`
*   `Avatar` always needs `AvatarFallback`
*   Use `Alert` for callouts, `Empty` for empty states, `Skeleton` for loading, `Badge` for status

### Icons

*   Icons in Button use `data-icon`
*   No sizing classes on icons inside components — components handle icon sizing via CSS

## Component Import

All components are available from `__IMPORT_PATH__`:

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from '__IMPORT_PATH__';
```

Icons are available from `lucide-react`:

```tsx
import { ArrowRight, Check, X, MoreHorizontal } from 'lucide-react';
```

## Component Structure

Your component must:

1.  Accept a `data` prop with the provided TypeScript interface
2.  Export a default function component
3.  Return a single root element

```tsx
interface Props {
  data: DataType;
}

export default function Page({ data }: Props) {
  return <div className="container mx-auto p-6">{/* Your UI here */}</div>;
}
```

* * *

## shadcn/ui Reference

* * *

## name: shadcn description: Manages shadcn components and projects — adding, searching, fixing, debugging, styling, and composing UI. Provides project context, component docs, and usage examples. Applies when working with shadcn/ui, component registries, presets, --preset codes, or any project with a components.json file. Also triggers for "shadcn init", "create an app with --preset", or "switch to --preset". user-invocable: false allowed-tools: Bash(npx shadcn@latest \*), Bash(pnpm dlx shadcn@latest \*), Bash(bunx --bun shadcn@latest \*)

# shadcn/ui

A framework for building ui, components and design systems. Components are added as source code to the user's project via the CLI.

> **IMPORTANT:** Run all CLI commands using the project's package runner: `npx shadcn@latest`, `pnpm dlx shadcn@latest`, or `bunx --bun shadcn@latest` — based on the project's `packageManager`. Examples below use `npx shadcn@latest` but substitute the correct runner for the project.

## Current Project Context

```json
!`npx shadcn@latest info --json`
```

The JSON above contains the project config and installed components. Use `npx shadcn@latest docs <component>` to get documentation and example URLs for any component.

## Principles

1.  **Use existing components first.** Use `npx shadcn@latest search` to check registries before writing custom UI. Check community registries too.
2.  **Compose, don't reinvent.** Settings page = Tabs + Card + form controls. Dashboard = Sidebar + Card + Chart + Table.
3.  **Use built-in variants before custom styles.** `variant="outline"`, `size="sm"`, etc.
4.  **Use semantic colors.** `bg-primary`, `text-muted-foreground` — never raw values like `bg-blue-500`.

## Critical Rules

These rules are **always enforced**. Each links to a file with Incorrect/Correct code pairs.

### Styling & Tailwind → [styling.md](./rules/styling.md)

*   **`className` for layout, not styling.** Never override component colors or typography.
*   **No `space-x-*` or `space-y-*`.** Use `flex` with `gap-*`. For vertical stacks, `flex flex-col gap-*`.
*   **Use `size-*` when width and height are equal.** `size-10` not `w-10 h-10`.
*   **Use `truncate` shorthand.** Not `overflow-hidden text-ellipsis whitespace-nowrap`.
*   **No manual `dark:` color overrides.** Use semantic tokens (`bg-background`, `text-muted-foreground`).
*   **Use `cn()` for conditional classes.** Don't write manual template literal ternaries.
*   **No manual `z-index` on overlay components.** Dialog, Sheet, Popover, etc. handle their own stacking.

### Forms & Inputs → [forms.md](./rules/forms.md)

*   **Forms use `FieldGroup` + `Field`.** Never use raw `div` with `space-y-*` or `grid gap-*` for form layout.
*   **`InputGroup` uses `InputGroupInput`/`InputGroupTextarea`.** Never raw `Input`/`Textarea` inside `InputGroup`.
*   **Buttons inside inputs use `InputGroup` + `InputGroupAddon`.**
*   **Option sets (2–7 choices) use `ToggleGroup`.** Don't loop `Button` with manual active state.
*   **`FieldSet` + `FieldLegend` for grouping related checkboxes/radios.** Don't use a `div` with a heading.
*   **Field validation uses `data-invalid` + `aria-invalid`.** `data-invalid` on `Field`, `aria-invalid` on the control. For disabled: `data-disabled` on `Field`, `disabled` on the control.

### Component Structure → [composition.md](./rules/composition.md)

*   **Items always inside their Group.** `SelectItem` → `SelectGroup`. `DropdownMenuItem` → `DropdownMenuGroup`. `CommandItem` → `CommandGroup`.
*   **Use `asChild` (radix) or `render` (base) for custom triggers.** Check `base` field from `npx shadcn@latest info`. → [base-vs-radix.md](./rules/base-vs-radix.md)
*   **Dialog, Sheet, and Drawer always need a Title.** `DialogTitle`, `SheetTitle`, `DrawerTitle` required for accessibility. Use `className="sr-only"` if visually hidden.
*   **Use full Card composition.** `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`. Don't dump everything in `CardContent`.
*   **Button has no `isPending`/`isLoading`.** Compose with `Spinner` + `data-icon` + `disabled`.
*   **`TabsTrigger` must be inside `TabsList`.** Never render triggers directly in `Tabs`.
*   **`Avatar` always needs `AvatarFallback`.** For when the image fails to load.

### Use Components, Not Custom Markup → [composition.md](./rules/composition.md)

*   **Use existing components before custom markup.** Check if a component exists before writing a styled `div`.
*   **Callouts use `Alert`.** Don't build custom styled divs.
*   **Empty states use `Empty`.** Don't build custom empty state markup.
*   **Toast via `sonner`.** Use `toast()` from `sonner`.
*   **Use `Separator`** instead of `<hr>` or `<div className="border-t">`.
*   **Use `Skeleton`** for loading placeholders. No custom `animate-pulse` divs.
*   **Use `Badge`** instead of custom styled spans.

### Icons → [icons.md](./rules/icons.md)

*   **Icons in `Button` use `data-icon`.** `data-icon="inline-start"` or `data-icon="inline-end"` on the icon.
*   **No sizing classes on icons inside components.** Components handle icon sizing via CSS. No `size-4` or `w-4 h-4`.
*   **Pass icons as objects, not string keys.** `icon={CheckIcon}`, not a string lookup.

### CLI

*   **Never decode or fetch preset codes manually.** Pass them directly to `npx shadcn@latest init --preset <code>`.

## Key Patterns

These are the most common patterns that differentiate correct shadcn/ui code. For edge cases, see the linked rule files above.

```tsx
// Form layout: FieldGroup + Field, not div + Label.
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" />
  </Field>
</FieldGroup>

// Validation: data-invalid on Field, aria-invalid on the control.
<Field data-invalid>
  <FieldLabel>Email</FieldLabel>
  <Input aria-invalid />
  <FieldDescription>Invalid email.</FieldDescription>
</Field>

// Icons in buttons: data-icon, no sizing classes.
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

// Spacing: gap-*, not space-y-*.
<div className="flex flex-col gap-4">  // correct
<div className="space-y-4">           // wrong

// Equal dimensions: size-*, not w-* h-*.
<Avatar className="size-10">   // correct
<Avatar className="w-10 h-10"> // wrong

// Status colors: Badge variants or semantic tokens, not raw colors.
<Badge variant="secondary">+20.1%</Badge>    // correct
<span className="text-emerald-600">+20.1%</span> // wrong
```

## Component Selection

| Need | Use | | -------------------------- | --------------------------------------------------------------------------------------------------- | | Button/action | `Button` with appropriate variant | | Form inputs | `Input`, `Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `InputOTP`, `Slider` | | Toggle between 2–5 options | `ToggleGroup` + `ToggleGroupItem` | | Data display | `Table`, `Card`, `Badge`, `Avatar` | | Navigation | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination` | | Overlays | `Dialog` (modal), `Sheet` (side panel), `Drawer` (bottom sheet), `AlertDialog` (confirmation) | | Feedback | `sonner` (toast), `Alert`, `Progress`, `Skeleton`, `Spinner` | | Command palette | `Command` inside `Dialog` | | Charts | `Chart` (wraps Recharts) | | Layout | `Card`, `Separator`, `Resizable`, `ScrollArea`, `Accordion`, `Collapsible` | | Empty states | `Empty` | | Menus | `DropdownMenu`, `ContextMenu`, `Menubar` | | Tooltips/info | `Tooltip`, `HoverCard`, `Popover` |

## Key Fields

The injected project context contains these key fields:

*   **`aliases`** → use the actual alias prefix for imports (e.g. `@/`, `~/`), never hardcode.
*   **`isRSC`** → when `true`, components using `useState`, `useEffect`, event handlers, or browser APIs need `"use client"` at the top of the file. Always reference this field when advising on the directive.
*   **`tailwindVersion`** → `"v4"` uses `@theme inline` blocks; `"v3"` uses `tailwind.config.js`.
*   **`tailwindCssFile`** → the global CSS file where custom CSS variables are defined. Always edit this file, never create a new one.
*   **`style`** → component visual treatment (e.g. `nova`, `vega`).
*   **`base`** → primitive library (`radix` or `base`). Affects component APIs and available props.
*   **`iconLibrary`** → determines icon imports. Use `lucide-react` for `lucide`, `@tabler/icons-react` for `tabler`, etc. Never assume `lucide-react`.
*   **`resolvedPaths`** → exact file-system destinations for components, utils, hooks, etc.
*   **`framework`** → routing and file conventions (e.g. Next.js App Router vs Vite SPA).
*   **`packageManager`** → use this for any non-shadcn dependency installs (e.g. `pnpm add date-fns` vs `npm install date-fns`).

See [cli.md — `info` command](./cli.md) for the full field reference.

## Component Docs, Examples, and Usage

Run `npx shadcn@latest docs <component>` to get the URLs for a component's documentation, examples, and API reference. Fetch these URLs to get the actual content.

```bash
npx shadcn@latest docs button dialog select
```

**When creating, fixing, debugging, or using a component, always run `npx shadcn@latest docs` and fetch the URLs first.** This ensures you're working with the correct API and usage patterns rather than guessing.

## Workflow

1.  **Get project context** — already injected above. Run `npx shadcn@latest info` again if you need to refresh.
2.  **Check installed components first** — before running `add`, always check the `components` list from project context or list the `resolvedPaths.ui` directory. Don't import components that haven't been added, and don't re-add ones already installed.
3.  **Find components** — `npx shadcn@latest search`.
4.  **Get docs and examples** — run `npx shadcn@latest docs <component>` to get URLs, then fetch them. Use `npx shadcn@latest view` to browse registry items you haven't installed. To preview changes to installed components, use `npx shadcn@latest add --diff`.
5.  **Install or update** — `npx shadcn@latest add`. When updating existing components, use `--dry-run` and `--diff` to preview changes first (see [Updating Components](#updating-components) below).
6.  **Fix imports in third-party components** — After adding components from community registries (e.g. `@bundui`, `@magicui`), check the added non-UI files for hardcoded import paths like `@/components/ui/...`. These won't match the project's actual aliases. Use `npx shadcn@latest info` to get the correct `ui` alias (e.g. `@workspace/ui/components`) and rewrite the imports accordingly. The CLI rewrites imports for its own UI files, but third-party registry components may use default paths that don't match the project.
7.  **Review added components** — After adding a component or block from any registry, **always read the added files and verify they are correct**. Check for missing sub-components (e.g. `SelectItem` without `SelectGroup`), missing imports, incorrect composition, or violations of the [Critical Rules](#critical-rules). Also replace any icon imports with the project's `iconLibrary` from the project context (e.g. if the registry item uses `lucide-react` but the project uses `hugeicons`, swap the imports and icon names accordingly). Fix all issues before moving on.
8.  **Registry must be explicit** — When the user asks to add a block or component, **do not guess the registry**. If no registry is specified (e.g. user says "add a login block" without specifying `@shadcn`, `@tailark`, etc.), ask which registry to use. Never default to a registry on behalf of the user.
9.  **Switching presets** — Ask the user first: **reinstall**, **merge**, or **skip**?
    *   **Reinstall**: `npx shadcn@latest init --preset <code> --force --reinstall`. Overwrites all components.
    *   **Merge**: `npx shadcn@latest init --preset <code> --force --no-reinstall`, then run `npx shadcn@latest info` to list installed components, then for each installed component use `--dry-run` and `--diff` to [smart merge](#updating-components) it individually.
    *   **Skip**: `npx shadcn@latest init --preset <code> --force --no-reinstall`. Only updates config and CSS, leaves components as-is.
    *   **Important**: Always run preset commands inside the user's project directory. The CLI automatically preserves the current base (`base` vs `radix`) from `components.json`. If you must use a scratch/temp directory (e.g. for `--dry-run` comparisons), pass `--base <current-base>` explicitly — preset codes do not encode the base.

## Updating Components

When the user asks to update a component from upstream while keeping their local changes, use `--dry-run` and `--diff` to intelligently merge. **NEVER fetch raw files from GitHub manually — always use the CLI.**

1.  Run `npx shadcn@latest add <component> --dry-run` to see all files that would be affected.
2.  For each file, run `npx shadcn@latest add <component> --diff <file>` to see what changed upstream vs local.
3.  Decide per file based on the diff:
    *   No local changes → safe to overwrite.
    *   Has local changes → read the local file, analyze the diff, and apply upstream updates while preserving local modifications.
    *   User says "just update everything" → use `--overwrite`, but confirm first.
4.  **Never use `--overwrite` without the user's explicit approval.**

## Quick Reference

```bash
# Create a new project.
npx shadcn@latest init --name my-app --preset base-nova
npx shadcn@latest init --name my-app --preset a2r6bw --template vite

# Create a monorepo project.
npx shadcn@latest init --name my-app --preset base-nova --monorepo
npx shadcn@latest init --name my-app --preset base-nova --template next --monorepo

# Initialize existing project.
npx shadcn@latest init --preset base-nova
npx shadcn@latest init --defaults  # shortcut: --template=next --preset=base-nova

# Add components.
npx shadcn@latest add button card dialog
npx shadcn@latest add @magicui/shimmer-button
npx shadcn@latest add --all

# Preview changes before adding/updating.
npx shadcn@latest add button --dry-run
npx shadcn@latest add button --diff button.tsx
npx shadcn@latest add @acme/form --view button.tsx

# Search registries.
npx shadcn@latest search @shadcn -q "sidebar"
npx shadcn@latest search @tailark -q "stats"

# Get component docs and example URLs.
npx shadcn@latest docs button dialog select

# View registry item details (for items not yet installed).
npx shadcn@latest view @shadcn/button
```

**Named presets:** `base-nova`, `radix-nova` **Templates:** `next`, `vite`, `start`, `react-router`, `astro` (all support `--monorepo`) and `laravel` (not supported for monorepo) **Preset codes:** Base62 strings starting with `a` (e.g. `a2r6bw`), from [ui.shadcn.com](https://ui.shadcn.com).

## Detailed References

*   [rules/forms.md](./rules/forms.md) — FieldGroup, Field, InputGroup, ToggleGroup, FieldSet, validation states
*   [rules/composition.md](./rules/composition.md) — Groups, overlays, Card, Tabs, Avatar, Alert, Empty, Toast, Separator, Skeleton, Badge, Button loading
*   [rules/icons.md](./rules/icons.md) — data-icon, icon sizing, passing icons as objects
*   [rules/styling.md](./rules/styling.md) — Semantic colors, variants, className, spacing, size, truncate, dark mode, cn(), z-index
*   [rules/base-vs-radix.md](./rules/base-vs-radix.md) — asChild vs render, Select, ToggleGroup, Slider, Accordion
*   [cli.md](./cli.md) — Commands, flags, presets, templates
*   [customization.md](./customization.md) — Theming, CSS variables, extending components

## Styling Rules

# Styling & Customization

See [customization.md](../customization.md) for theming, CSS variables, and adding custom colors.

## Contents

*   Semantic colors
*   Built-in variants first
*   className for layout only
*   No space-x-\* / space-y-\*
*   Prefer size-\* over w-\* h-\* when equal
*   Prefer truncate shorthand
*   No manual dark: color overrides
*   Use cn() for conditional classes
*   No manual z-index on overlay components

* * *

## Semantic colors

**Incorrect:**

```tsx
<div className="bg-blue-500 text-white">
  <p className="text-gray-600">Secondary text</p>
</div>
```

**Correct:**

```tsx
<div className="bg-primary text-primary-foreground">
  <p className="text-muted-foreground">Secondary text</p>
</div>
```

* * *

## No raw color values for status/state indicators

For positive, negative, or status indicators, use Badge variants, semantic tokens like `text-destructive`, or define custom CSS variables — don't reach for raw Tailwind colors.

**Incorrect:**

```tsx
<span className="text-emerald-600">+20.1%</span>
<span className="text-green-500">Active</span>
<span className="text-red-600">-3.2%</span>
```

**Correct:**

```tsx
<Badge variant="secondary">+20.1%</Badge>
<Badge>Active</Badge>
<span className="text-destructive">-3.2%</span>
```

If you need a success/positive color that doesn't exist as a semantic token, use a Badge variant or ask the user about adding a custom CSS variable to the theme (see [customization.md](../customization.md)).

* * *

## Built-in variants first

**Incorrect:**

```tsx
<Button className="border border-input bg-transparent hover:bg-accent">
  Click me
</Button>
```

**Correct:**

```tsx
<Button variant="outline">Click me</Button>
```

* * *

## className for layout only

Use `className` for layout (e.g. `max-w-md`, `mx-auto`, `mt-4`), **not** for overriding component colors or typography. To change colors, use semantic tokens, built-in variants, or CSS variables.

**Incorrect:**

```tsx
<Card className="bg-blue-100 text-blue-900 font-bold">
  <CardContent>Dashboard</CardContent>
</Card>
```

**Correct:**

```tsx
<Card className="max-w-md mx-auto">
  <CardContent>Dashboard</CardContent>
</Card>
```

To customize a component's appearance, prefer these approaches in order:

1.  **Built-in variants** — `variant="outline"`, `variant="destructive"`, etc.
2.  **Semantic color tokens** — `bg-primary`, `text-muted-foreground`.
3.  **CSS variables** — define custom colors in the global CSS file (see [customization.md](../customization.md)).

* * *

## No space-x-\* / space-y-\*

Use `gap-*` instead. `space-y-4` → `flex flex-col gap-4`. `space-x-2` → `flex gap-2`.

```tsx
<div className="flex flex-col gap-4">
  <Input />
  <Input />
  <Button>Submit</Button>
</div>
```

* * *

## Prefer size-\* over w-\* h-\* when equal

`size-10` not `w-10 h-10`. Applies to icons, avatars, skeletons, etc.

* * *

## Prefer truncate shorthand

`truncate` not `overflow-hidden text-ellipsis whitespace-nowrap`.

* * *

## No manual dark: color overrides

Use semantic tokens — they handle light/dark via CSS variables. `bg-background text-foreground` not `bg-white dark:bg-gray-950`.

* * *

## Use cn() for conditional classes

Use the `cn()` utility from the project for conditional or merged class names. Don't write manual ternaries in className strings.

**Incorrect:**

```tsx
<div className={`flex items-center ${isActive ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
```

**Correct:**

```tsx
import { cn } from "@/lib/utils"

<div className={cn("flex items-center", isActive ? "bg-primary text-primary-foreground" : "bg-muted")}>
```

* * *

## No manual z-index on overlay components

`Dialog`, `Sheet`, `Drawer`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`, `HoverCard` handle their own stacking. Never add `z-50` or `z-[999]`.

## Composition Rules

# Component Composition

## Contents

*   Items always inside their Group component
*   Callouts use Alert
*   Empty states use Empty component
*   Toast notifications use sonner
*   Choosing between overlay components
*   Dialog, Sheet, and Drawer always need a Title
*   Card structure
*   Button has no isPending or isLoading prop
*   TabsTrigger must be inside TabsList
*   Avatar always needs AvatarFallback
*   Use Separator instead of raw hr or border divs
*   Use Skeleton for loading placeholders
*   Use Badge instead of custom styled spans

* * *

## Items always inside their Group component

Never render items directly inside the content container.

**Incorrect:**

```tsx
<SelectContent>
  <SelectItem value="apple">Apple</SelectItem>
  <SelectItem value="banana">Banana</SelectItem>
</SelectContent>
```

**Correct:**

```tsx
<SelectContent>
  <SelectGroup>
    <SelectItem value="apple">Apple</SelectItem>
    <SelectItem value="banana">Banana</SelectItem>
  </SelectGroup>
</SelectContent>
```

This applies to all group-based components:

| Item | Group | |------|-------| | `SelectItem`, `SelectLabel` | `SelectGroup` | | `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSub` | `DropdownMenuGroup` | | `MenubarItem` | `MenubarGroup` | | `ContextMenuItem` | `ContextMenuGroup` | | `CommandItem` | `CommandGroup` |

* * *

## Callouts use Alert

```tsx
<Alert>
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Something needs attention.</AlertDescription>
</Alert>
```

* * *

## Empty states use Empty component

```tsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><FolderIcon /></EmptyMedia>
    <EmptyTitle>No projects yet</EmptyTitle>
    <EmptyDescription>Get started by creating a new project.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button>Create Project</Button>
  </EmptyContent>
</Empty>
```

* * *

## Toast notifications use sonner

```tsx
import { toast } from "sonner"

toast.success("Changes saved.")
toast.error("Something went wrong.")
toast("File deleted.", {
  action: { label: "Undo", onClick: () => undoDelete() },
})
```

* * *

## Choosing between overlay components

| Use case | Component | |----------|-----------| | Focused task that requires input | `Dialog` | | Destructive action confirmation | `AlertDialog` | | Side panel with details or filters | `Sheet` | | Mobile-first bottom panel | `Drawer` | | Quick info on hover | `HoverCard` | | Small contextual content on click | `Popover` |

* * *

## Dialog, Sheet, and Drawer always need a Title

`DialogTitle`, `SheetTitle`, `DrawerTitle` are required for accessibility. Use `className="sr-only"` if visually hidden.

```tsx
<DialogContent>
  <DialogHeader>
    <DialogTitle>Edit Profile</DialogTitle>
    <DialogDescription>Update your profile.</DialogDescription>
  </DialogHeader>
  ...
</DialogContent>
```

* * *

## Card structure

Use full composition — don't dump everything into `CardContent`:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Team Members</CardTitle>
    <CardDescription>Manage your team.</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>
    <Button>Invite</Button>
  </CardFooter>
</Card>
```

* * *

## Button has no isPending or isLoading prop

Compose with `Spinner` + `data-icon` + `disabled`:

```tsx
<Button disabled>
  <Spinner data-icon="inline-start" />
  Saving...
</Button>
```

* * *

## TabsTrigger must be inside TabsList

Never render `TabsTrigger` directly inside `Tabs` — always wrap in `TabsList`:

```tsx
<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">...</TabsContent>
</Tabs>
```

* * *

## Avatar always needs AvatarFallback

Always include `AvatarFallback` for when the image fails to load:

```tsx
<Avatar>
  <AvatarImage src="/avatar.png" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

* * *

## Use existing components instead of custom markup

| Instead of | Use | |---|---| | `<hr>` or `<div className="border-t">` | `<Separator />` | | `<div className="animate-pulse">` with styled divs | `<Skeleton className="h-4 w-3/4" />` | | `<span className="rounded-full bg-green-100 ...">` | `<Badge variant="secondary">` |

## Form Rules

# Forms & Inputs

## Contents

*   Forms use FieldGroup + Field
*   InputGroup requires InputGroupInput/InputGroupTextarea
*   Buttons inside inputs use InputGroup + InputGroupAddon
*   Option sets (2–7 choices) use ToggleGroup
*   FieldSet + FieldLegend for grouping related fields
*   Field validation and disabled states

* * *

## Forms use FieldGroup + Field

Always use `FieldGroup` + `Field` — never raw `div` with `space-y-*`:

```tsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" type="email" />
  </Field>
  <Field>
    <FieldLabel htmlFor="password">Password</FieldLabel>
    <Input id="password" type="password" />
  </Field>
</FieldGroup>
```

Use `Field orientation="horizontal"` for settings pages. Use `FieldLabel className="sr-only"` for visually hidden labels.

**Choosing form controls:**

*   Simple text input → `Input`
*   Dropdown with predefined options → `Select`
*   Searchable dropdown → `Combobox`
*   Native HTML select (no JS) → `native-select`
*   Boolean toggle → `Switch` (for settings) or `Checkbox` (for forms)
*   Single choice from few options → `RadioGroup`
*   Toggle between 2–5 options → `ToggleGroup` + `ToggleGroupItem`
*   OTP/verification code → `InputOTP`
*   Multi-line text → `Textarea`

* * *

## InputGroup requires InputGroupInput/InputGroupTextarea

Never use raw `Input` or `Textarea` inside an `InputGroup`.

**Incorrect:**

```tsx
<InputGroup>
  <Input placeholder="Search..." />
</InputGroup>
```

**Correct:**

```tsx
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search..." />
</InputGroup>
```

* * *

## Buttons inside inputs use InputGroup + InputGroupAddon

Never place a `Button` directly inside or adjacent to an `Input` with custom positioning.

**Incorrect:**

```tsx
<div className="relative">
  <Input placeholder="Search..." className="pr-10" />
  <Button className="absolute right-0 top-0" size="icon">
    <SearchIcon />
  </Button>
</div>
```

**Correct:**

```tsx
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon>
    <Button size="icon">
      <SearchIcon data-icon="inline-start" />
    </Button>
  </InputGroupAddon>
</InputGroup>
```

* * *

## Option sets (2–7 choices) use ToggleGroup

Don't manually loop `Button` components with active state.

**Incorrect:**

```tsx
const [selected, setSelected] = useState("daily")

<div className="flex gap-2">
  {["daily", "weekly", "monthly"].map((option) => (
    <Button
      key={option}
      variant={selected === option ? "default" : "outline"}
      onClick={() => setSelected(option)}
    >
      {option}
    </Button>
  ))}
</div>
```

**Correct:**

```tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

<ToggleGroup spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
  <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
</ToggleGroup>
```

Combine with `Field` for labelled toggle groups:

```tsx
<Field orientation="horizontal">
  <FieldTitle id="theme-label">Theme</FieldTitle>
  <ToggleGroup aria-labelledby="theme-label" spacing={2}>
    <ToggleGroupItem value="light">Light</ToggleGroupItem>
    <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    <ToggleGroupItem value="system">System</ToggleGroupItem>
  </ToggleGroup>
</Field>
```

> **Note:** `defaultValue` and `type`/`multiple` props differ between base and radix. See [base-vs-radix.md](./base-vs-radix.md#togglegroup).

* * *

## FieldSet + FieldLegend for grouping related fields

Use `FieldSet` + `FieldLegend` for related checkboxes, radios, or switches — not `div` with a heading:

```tsx
<FieldSet>
  <FieldLegend variant="label">Preferences</FieldLegend>
  <FieldDescription>Select all that apply.</FieldDescription>
  <FieldGroup className="gap-3">
    <Field orientation="horizontal">
      <Checkbox id="dark" />
      <FieldLabel htmlFor="dark" className="font-normal">Dark mode</FieldLabel>
    </Field>
  </FieldGroup>
</FieldSet>
```

* * *

## Field validation and disabled states

Both attributes are needed — `data-invalid`/`data-disabled` styles the field (label, description), while `aria-invalid`/`disabled` styles the control.

```tsx
// Invalid.
<Field data-invalid>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" aria-invalid />
  <FieldDescription>Invalid email address.</FieldDescription>
</Field>

// Disabled.
<Field data-disabled>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" disabled />
</Field>
```

Works for all controls: `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroupItem`, `Switch`, `Slider`, `NativeSelect`, `InputOTP`.

## Icon Rules

# Icons

**Always use the project's configured `iconLibrary` for imports.** Check the `iconLibrary` field from project context: `lucide` → `lucide-react`, `tabler` → `@tabler/icons-react`, etc. Never assume `lucide-react`.

* * *

## Icons in Button use data-icon attribute

Add `data-icon="inline-start"` (prefix) or `data-icon="inline-end"` (suffix) to the icon. No sizing classes on the icon.

**Incorrect:**

```tsx
<Button>
  <SearchIcon className="mr-2 size-4" />
  Search
</Button>
```

**Correct:**

```tsx
<Button>
  <SearchIcon data-icon="inline-start"/>
  Search
</Button>

<Button>
  Next
  <ArrowRightIcon data-icon="inline-end"/>
</Button>
```

* * *

## No sizing classes on icons inside components

Components handle icon sizing via CSS. Don't add `size-4`, `w-4 h-4`, or other sizing classes to icons inside `Button`, `DropdownMenuItem`, `Alert`, `Sidebar*`, or other shadcn components. Unless the user explicitly asks for custom icon sizes.

**Incorrect:**

```tsx
<Button>
  <SearchIcon className="size-4" data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon className="mr-2 size-4" />
  Settings
</DropdownMenuItem>
```

**Correct:**

```tsx
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon />
  Settings
</DropdownMenuItem>
```

* * *

## Pass icons as component objects, not string keys

Use `icon={CheckIcon}`, not a string key to a lookup map.

**Incorrect:**

```tsx
const iconMap = {
  check: CheckIcon,
  alert: AlertIcon,
}

function StatusBadge({ icon }: { icon: string }) {
  const Icon = iconMap[icon]
  return <Icon />
}

<StatusBadge icon="check" />
```

**Correct:**

```tsx
// Import from the project's configured iconLibrary (e.g. lucide-react, @tabler/icons-react).
import { CheckIcon } from "lucide-react"

function StatusBadge({ icon: Icon }: { icon: React.ComponentType }) {
  return <Icon />
}

<StatusBadge icon={CheckIcon} />
```

## Customization

# Customization & Theming

Components reference semantic CSS variable tokens. Change the variables to change every component.

## Contents

*   How it works (CSS variables → Tailwind utilities → components)
*   Color variables and OKLCH format
*   Dark mode setup
*   Changing the theme (presets, CSS variables)
*   Adding custom colors (Tailwind v3 and v4)
*   Border radius
*   Customizing components (variants, className, wrappers)
*   Checking for updates

* * *

## How It Works

1.  CSS variables defined in `:root` (light) and `.dark` (dark mode).
2.  Tailwind maps them to utilities: `bg-primary`, `text-muted-foreground`, etc.
3.  Components use these utilities — changing a variable changes all components that reference it.

* * *

## Color Variables

Every color follows the `name` / `name-foreground` convention. The base variable is for backgrounds, `-foreground` is for text/icons on that background.

| Variable | Purpose | | -------------------------------------------- | -------------------------------- | | `--background` / `--foreground` | Page background and default text | | `--card` / `--card-foreground` | Card surfaces | | `--primary` / `--primary-foreground` | Primary buttons and actions | | `--secondary` / `--secondary-foreground` | Secondary actions | | `--muted` / `--muted-foreground` | Muted/disabled states | | `--accent` / `--accent-foreground` | Hover and accent states | | `--destructive` / `--destructive-foreground` | Error and destructive actions | | `--border` | Default border color | | `--input` | Form input borders | | `--ring` | Focus ring color | | `--chart-1` through `--chart-5` | Chart/data visualization | | `--sidebar-*` | Sidebar-specific colors | | `--surface` / `--surface-foreground` | Secondary surface |

Colors use OKLCH: `--primary: oklch(0.205 0 0)` where values are lightness (0–1), chroma (0 = gray), and hue (0–360).

* * *

## Dark Mode

Class-based toggle via `.dark` on the root element. In Next.js, use `next-themes`:

```tsx
import { ThemeProvider } from "next-themes"

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

* * *

## Changing the Theme

```bash
# Apply a preset code from ui.shadcn.com.
npx shadcn@latest init --preset a2r6bw --force

# Switch to a named preset.
npx shadcn@latest init --preset radix-nova --force
npx shadcn@latest init --reinstall  # update existing components to match

# Use a custom theme URL.
npx shadcn@latest init --preset "https://ui.shadcn.com/init?base=radix&style=nova&theme=blue&..." --force
```

Or edit CSS variables directly in `globals.css`.

* * *

## Adding Custom Colors

Add variables to the file at `tailwindCssFile` from `npx shadcn@latest info` (typically `globals.css`). Never create a new CSS file for this.

```css
/* 1. Define in the global CSS file. */
:root {
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
}
.dark {
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
}
```

```css
/* 2a. Register with Tailwind v4 (@theme inline). */
@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

When `tailwindVersion` is `"v3"` (check via `npx shadcn@latest info`), register in `tailwind.config.js` instead:

```js
// 2b. Register with Tailwind v3 (tailwind.config.js).
module.exports = {
  theme: {
    extend: {
      colors: {
        warning: "oklch(var(--warning) / <alpha-value>)",
        "warning-foreground":
          "oklch(var(--warning-foreground) / <alpha-value>)",
      },
    },
  },
}
```

```tsx
// 3. Use in components.
<div className="bg-warning text-warning-foreground">Warning</div>
```

* * *

## Border Radius

`--radius` controls border radius globally. Components derive values from it (`rounded-lg` = `var(--radius)`, `rounded-md` = `calc(var(--radius) - 2px)`).

* * *

## Customizing Components

See also: [rules/styling.md](./rules/styling.md) for Incorrect/Correct examples.

Prefer these approaches in order:

### 1\. Built-in variants

```tsx
<Button variant="outline" size="sm">Click</Button>
```

### 2\. Tailwind classes via `className`

```tsx
<Card className="max-w-md mx-auto">...</Card>
```

### 3\. Add a new variant

Edit the component source to add a variant via `cva`:

```tsx
// components/ui/button.tsx
warning: "bg-warning text-warning-foreground hover:bg-warning/90",
```

### 4\. Wrapper components

Compose shadcn/ui primitives into higher-level components:

```tsx
export function ConfirmDialog({ title, description, onConfirm, children }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

* * *

## Checking for Updates

```bash
npx shadcn@latest add button --diff
```

To preview exactly what would change before updating, use `--dry-run` and `--diff`:

```bash
npx shadcn@latest add button --dry-run        # see all affected files
npx shadcn@latest add button --diff button.tsx # see the diff for a specific file
```

See [Updating Components in SKILL.md](./SKILL.md#updating-components) for the full smart merge workflow.