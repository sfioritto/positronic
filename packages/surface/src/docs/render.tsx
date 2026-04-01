import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TurndownService from 'turndown';
import { run } from '@mdx-js/mdx';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Preserve fenced code blocks with language info
turndown.addRule('fencedCodeBlock', {
  filter: (node) =>
    node.nodeName === 'PRE' &&
    node.firstChild !== null &&
    node.firstChild.nodeName === 'CODE',
  replacement: (content, node) => {
    const codeNode = (node as HTMLElement).querySelector('code');
    const lang = codeNode?.className?.replace('language-', '') || '';
    const code = codeNode?.textContent || '';
    return `\n\n\`\`\`${lang}\n${code}\`\`\`\n\n`;
  },
});

async function loadMdxModule(filename: string) {
  const source = readFileSync(join(dir, filename), 'utf-8');
  const { default: Component } = await run(source, {
    ...jsxRuntime,
    baseUrl: import.meta.url,
  });
  return Component;
}

/**
 * Render the design system MDX doc to markdown.
 * The __IMPORT_PATH__ placeholder is replaced with the given importPath.
 */
export async function renderDesignSystem(importPath: string) {
  const DesignSystem = await loadMdxModule('design-system.js');
  const html = renderToStaticMarkup(React.createElement(DesignSystem));
  const markdown = turndown.turndown(html);
  return markdown.replaceAll('__IMPORT_PATH__', importPath);
}

/**
 * Render the full system prompt: design system doc + skill docs.
 */
export async function renderSystemPrompt(params: {
  importPath: string;
  skillDocs?: string;
}) {
  const designSystem = await renderDesignSystem(params.importPath);
  if (!params.skillDocs) return designSystem;
  return `${designSystem}\n\n---\n\n${params.skillDocs}`;
}
