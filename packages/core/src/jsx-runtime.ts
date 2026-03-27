// Custom JSX runtime for Positronic template authoring.
// This module is imported automatically by the JSX transform when
// jsxImportSource is set to "@positronic/core".

import type { JSX as ReactJSX } from 'react';

export const Fragment = Symbol.for('positronic.fragment');
export const File = Symbol.for('positronic.file');
export const Resource = Symbol.for('positronic.resource');

// Form is a symbol at runtime, but typed as a callable so TypeScript
// accepts <Form> in JSX. The renderer catches it by identity check
// before the function component fallback.
interface FormComponent {
  (props: Record<string, unknown>): TemplateNode;
}
export const Form: FormComponent = Symbol.for('positronic.form') as any;

type BuiltinComponent = typeof Fragment | typeof File | typeof Resource;

export type FunctionComponent = (
  props: Record<string, unknown>
) => TemplateChild | Promise<TemplateChild>;

export type ElementType = BuiltinComponent | FunctionComponent | string;

export interface TemplateNode {
  type: ElementType;
  props: Record<string, unknown>;
  children: TemplateChild[];
}

export type TemplateChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | TemplateNode
  | TemplateChild[];

// Called by the automatic JSX transform for elements with a single child
export function jsx(
  type: ElementType,
  props: Record<string, unknown>
): TemplateNode {
  const { children, ...rest } = props;
  return {
    type,
    props: rest,
    children: children == null ? [] : [children as TemplateChild],
  };
}

// Called by the automatic JSX transform for elements with multiple children
export const jsxs = jsx;

// Replace React's children type with TemplateChild for all HTML elements
type WithTemplateChildren<T> = Omit<T, 'children'> & {
  children?: TemplateChild;
};

type PositronicIntrinsicElements = {
  [K in keyof ReactJSX.IntrinsicElements]: WithTemplateChildren<
    ReactJSX.IntrinsicElements[K]
  >;
};

export namespace JSX {
  export type Element = TemplateNode;

  export interface IntrinsicElements extends PositronicIntrinsicElements {}

  export interface ElementChildrenAttribute {
    children: {};
  }
}
