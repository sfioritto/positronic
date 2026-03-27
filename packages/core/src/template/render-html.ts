import {
  Fragment,
  File,
  Resource,
  Form,
  type TemplateNode,
  type TemplateChild,
  type FunctionComponent,
} from '../jsx-runtime.js';

export interface RenderHtmlContext {
  formAction?: string;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

const PROP_ALIASES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  acceptCharset: 'accept-charset',
};

const BOOLEAN_ATTRS = new Set([
  'checked',
  'disabled',
  'readonly',
  'required',
  'autofocus',
  'autoplay',
  'controls',
  'defer',
  'hidden',
  'loop',
  'multiple',
  'muted',
  'novalidate',
  'open',
  'selected',
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function styleToString(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${cssKey}:${value}`;
    })
    .join(';');
}

function renderAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'dangerouslySetInnerHTML') continue;
    if (value == null || value === false) continue;

    const attrName = PROP_ALIASES[key] || key;

    if (BOOLEAN_ATTRS.has(attrName) && value === true) {
      parts.push(attrName);
      continue;
    }

    if (key === 'style' && typeof value === 'object') {
      parts.push(
        `style="${escapeAttr(
          styleToString(value as Record<string, string | number>)
        )}"`
      );
      continue;
    }

    parts.push(`${attrName}="${escapeAttr(String(value))}"`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function renderChildren(
  children: TemplateChild[],
  context: RenderHtmlContext
): string {
  return children.map((child) => renderNode(child, context)).join('');
}

function renderNode(node: TemplateChild, context: RenderHtmlContext): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (typeof node === 'number') return String(node);

  if (Array.isArray(node)) {
    return node.map((n) => renderNode(n, context)).join('');
  }

  // TemplateNode
  const templateNode = node as TemplateNode;

  if (templateNode.type === Fragment) {
    return renderChildren(templateNode.children, context);
  }

  if (templateNode.type === File || templateNode.type === Resource) {
    const name = templateNode.type === File ? 'File' : 'Resource';
    throw new Error(`<${name}> elements are not supported in HTML pages.`);
  }

  if (templateNode.type === Form) {
    const { children: _, ...restProps } = templateNode.props;
    const formProps = { ...restProps, method: 'POST' } as Record<
      string,
      unknown
    >;
    if (context.formAction) {
      formProps.action = context.formAction;
    }
    const body = renderChildren(templateNode.children, context);
    return `<form${renderAttrs(formProps)}>${body}</form>`;
  }

  // HTML element (string type)
  if (typeof templateNode.type === 'string') {
    const tag = templateNode.type;
    const attrs = renderAttrs(templateNode.props);

    if (VOID_ELEMENTS.has(tag)) {
      return `<${tag}${attrs}>`;
    }

    const body = renderChildren(templateNode.children, context);
    return `<${tag}${attrs}>${body}</${tag}>`;
  }

  // Function component (sync only)
  const fn = templateNode.type as FunctionComponent;
  const result = fn({ ...templateNode.props, children: templateNode.children });
  if (result && typeof (result as any).then === 'function') {
    throw new Error(
      'Async function components are not supported in HTML pages. ' +
        'Load data in a preceding .step() and pass it through state.'
    );
  }
  return renderNode(result as TemplateChild, context);
}

export function renderHtml(
  node: TemplateChild,
  context: RenderHtmlContext = {}
): string {
  return renderNode(node, context);
}

export function wrapHtmlDocument(
  body: string,
  options?: { title?: string }
): string {
  const title = options?.title;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${title ? `<title>${escapeHtml(title)}</title>` : ''}
</head>
<body>
${body}
</body>
</html>`;
}
