import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TurndownService from 'turndown';
import SystemPrompt from './system-prompt.mdx';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

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

/**
 * Render the full system prompt for the generation loop.
 */
export function renderSystemPrompt(importPath: string) {
  const html = renderToStaticMarkup(React.createElement(SystemPrompt, {}));
  return turndown.turndown(html).replaceAll('__IMPORT_PATH__', importPath);
}
