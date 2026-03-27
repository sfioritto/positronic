// Custom JSX runtime for Positronic template authoring.
// This module is imported automatically by the JSX transform when
// jsxImportSource is set to "@positronic/core".

import type { JSX as ReactJSX } from 'react';

export const Fragment = Symbol.for('positronic.fragment');
export const File = Symbol.for('positronic.file');
export const Resource = Symbol.for('positronic.resource');
export const Page = Symbol.for('positronic.page');
export const Form = Symbol.for('positronic.form');

type BuiltinComponent =
  | typeof Fragment
  | typeof File
  | typeof Resource
  | typeof Page
  | typeof Form;

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

export namespace JSX {
  export type Element = TemplateNode;

  // HTML intrinsic elements — borrowed from @types/react
  export interface IntrinsicElements extends ReactJSX.IntrinsicElements {}

  export interface ElementChildrenAttribute {
    children: {};
  }
}
