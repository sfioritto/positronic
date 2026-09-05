import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { createStateStore, type Spec } from '@json-render/core';
import {
  JSONUIProvider,
  Renderer,
  defineRegistry,
  useStateValue,
  type BaseComponentProps,
  type ComponentRegistry,
  type Components,
  type SetState,
} from '@json-render/react';
import { shadcnComponents } from '@json-render/shadcn';
import type { PageCatalog } from '@positronic/core/page';
import { catalog } from './catalog.js';
import { Checkbox } from './components/checkbox.js';
import { MultiTextInput } from './components/multi-text-input.js';
import { createSubmitForm } from './submit-form.js';

export { catalog, definitions, actions } from './catalog.js';
export { Checkbox, MultiTextInput };

/** A React implementation of a catalog component. */
export type PageComponent = (ctx: BaseComponentProps<any>) => ReactNode;

/**
 * React implementations for every component in the default catalog.
 * Extend with `{ ...components, Mine }` when a project adds a component.
 */
export const components: Record<string, PageComponent> = {
  Card: shadcnComponents.Card,
  Stack: shadcnComponents.Stack,
  Grid: shadcnComponents.Grid,
  Separator: shadcnComponents.Separator,
  Heading: shadcnComponents.Heading,
  Text: shadcnComponents.Text,
  Badge: shadcnComponents.Badge,
  Alert: shadcnComponents.Alert,
  Table: shadcnComponents.Table,
  Input: shadcnComponents.Input,
  Textarea: shadcnComponents.Textarea,
  Select: shadcnComponents.Select,
  Checkbox,
  Radio: shadcnComponents.Radio,
  Switch: shadcnComponents.Switch,
  MultiTextInput,
  Button: shadcnComponents.Button,
  Link: shadcnComponents.Link,
};

/** What core's `generatePageHtml` embeds as `window.__POSITRONIC_PAGE__`. */
export interface PageData {
  title: string;
  spec: Spec;
  formAction: string | null;
}

export interface MountOptions {
  /** The project's catalog, when it differs from the default */
  catalog?: PageCatalog;
  /** React implementations for every component in the catalog */
  components?: Record<string, PageComponent>;
}

function PositronicPage({
  spec,
  registry,
}: {
  spec: Spec;
  registry: ComponentRegistry;
}) {
  const submitted = useStateValue<boolean>('/submitted');
  const error = useStateValue<string>('/submitError');

  if (submitted) {
    return (
      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <p className="font-medium">Submitted.</p>
        <p className="text-sm text-muted-foreground">
          You can close this page.
        </p>
      </div>
    );
  }

  return (
    <>
      <Renderer spec={spec} registry={registry} />
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Render the page embedded in `window.__POSITRONIC_PAGE__` into `rootEl`.
 * The project's bundle entry calls this once the DOM is ready.
 */
export function mount(rootEl: HTMLElement, options: MountOptions = {}) {
  const page = (window as Window & { __POSITRONIC_PAGE__?: PageData })
    .__POSITRONIC_PAGE__;
  if (!page) {
    throw new Error(
      'window.__POSITRONIC_PAGE__ is not set; this bundle only runs inside a generated page.'
    );
  }

  const store = createStateStore(page.spec.state ?? {});
  const { registry, handlers } = defineRegistry(options.catalog ?? catalog, {
    components: (options.components ?? components) as Components<PageCatalog>,
    actions: { submitForm: createSubmitForm(page.formAction) },
  });

  // Action handlers get a React-style updater; apply its result to the store
  // one top-level key at a time.
  const setState: SetState = (updater) => {
    const prev = store.getSnapshot();
    const next = updater(prev);
    const updates: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (next[key] !== prev[key]) updates[`/${key}`] = next[key];
    }
    store.update(updates);
  };
  const actionHandlers = handlers(
    () => setState,
    () => store.getSnapshot()
  );

  createRoot(rootEl).render(
    <JSONUIProvider registry={registry} store={store} handlers={actionHandlers}>
      <main className="mx-auto max-w-3xl p-6">
        <PositronicPage spec={page.spec} registry={registry} />
      </main>
    </JSONUIProvider>
  );
}
