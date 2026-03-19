import {
  Fragment,
  type TemplateNode,
  type TemplateChild,
  type FunctionComponent,
} from '../jsx-runtime.js';
import type { TemplateReturn } from '../dsl/definitions/blocks.js';

export function isTemplateNode(value: unknown): value is TemplateNode {
  return (
    value != null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in value &&
    'children' in value
  );
}

export async function resolveTemplate(raw: TemplateReturn): Promise<string> {
  const resolved = await raw;
  if (typeof resolved === 'string') return resolved;
  return renderTemplate(resolved);
}

export async function renderTemplate(node: TemplateChild): Promise<string> {
  const raw = await renderNode(node);
  return dedent(raw);
}

async function renderNode(node: TemplateChild): Promise<string> {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);

  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(renderNode));
    return parts.join('');
  }

  // TemplateNode
  if (node.type === Fragment) {
    return renderNode(node.children);
  }

  // Function component
  const fn = node.type as FunctionComponent;
  const result = await fn({ ...node.props, children: node.children });
  return renderNode(result);
}

function dedent(text: string): string {
  // Trim leading and trailing whitespace-only lines
  const trimmed = text.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  if (!trimmed) return trimmed;

  const lines = trimmed.split('\n');

  // Find minimum indentation of non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^(\s*)/);
    if (indent && indent[1].length < minIndent) {
      minIndent = indent[1].length;
    }
  }

  if (minIndent === 0 || minIndent === Infinity) return trimmed;

  // Strip common indentation
  return lines.map((line) => line.slice(minIndent)).join('\n');
}
