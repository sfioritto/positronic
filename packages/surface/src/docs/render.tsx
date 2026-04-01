import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TurndownService from 'turndown';
import SystemPrompt from './system-prompt.mdx';
import skill from '../skills/SKILL.md';
import stylingRules from '../skills/rules/styling.md';
import compositionRules from '../skills/rules/composition.md';
import formRules from '../skills/rules/forms.md';
import iconRules from '../skills/rules/icons.md';
import customization from '../skills/customization.md';

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

const skillDocs = [
  skill,
  stylingRules,
  compositionRules,
  formRules,
  iconRules,
  customization,
].join('\n\n---\n\n');

/**
 * Render the full system prompt for the generation loop.
 */
export function renderSystemPrompt(importPath: string) {
  const html = renderToStaticMarkup(React.createElement(SystemPrompt, {}));
  const designSystem = turndown.turndown(html);
  return `${designSystem.replaceAll(
    '__IMPORT_PATH__',
    importPath
  )}\n\n---\n\n${skillDocs}`;
}
