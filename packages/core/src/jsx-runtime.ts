// Custom JSX runtime for Positronic template authoring.
// This module is imported automatically by the JSX transform when
// jsxImportSource is set to "@positronic/core".

export const Fragment = Symbol.for('positronic.fragment');
export const File = Symbol.for('positronic.file');
export const Resource = Symbol.for('positronic.resource');

type BuiltinComponent = typeof Fragment | typeof File | typeof Resource;

export type FunctionComponent = (
  props: Record<string, unknown>
) => TemplateChild | Promise<TemplateChild>;

export interface TemplateNode {
  type: BuiltinComponent | FunctionComponent;
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
  type: BuiltinComponent | FunctionComponent,
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

  // No intrinsic elements — only fragments and function components
  export interface IntrinsicElements {}

  export interface ElementChildrenAttribute {
    children: {};
  }
}
