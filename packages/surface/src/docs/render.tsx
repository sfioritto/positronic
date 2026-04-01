import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TurndownService from 'turndown';
import DesignSystem from './design-system.mdx';
import SHADCN_SKILL from '../skills/SKILL.md';
import SHADCN_RULES_STYLING from '../skills/rules/styling.md';
import SHADCN_RULES_COMPOSITION from '../skills/rules/composition.md';
import SHADCN_RULES_FORMS from '../skills/rules/forms.md';
import SHADCN_RULES_ICONS from '../skills/rules/icons.md';
import SHADCN_CUSTOMIZATION from '../skills/customization.md';

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

const ALL_SKILL_DOCS = [
  SHADCN_SKILL,
  SHADCN_RULES_STYLING,
  SHADCN_RULES_COMPOSITION,
  SHADCN_RULES_FORMS,
  SHADCN_RULES_ICONS,
  SHADCN_CUSTOMIZATION,
].join('\n\n---\n\n');

/**
 * Render the design system MDX doc to markdown.
 */
export function renderDesignSystem(importPath: string) {
  const html = renderToStaticMarkup(React.createElement(DesignSystem, {}));
  const markdown = turndown.turndown(html);
  return markdown.replaceAll('__IMPORT_PATH__', importPath);
}

/**
 * Render the full system prompt: design system doc + skill docs.
 */
export function renderSystemPrompt(params: { importPath: string }) {
  const designSystem = renderDesignSystem(params.importPath);
  return `${designSystem}\n\n---\n\n${ALL_SKILL_DOCS}`;
}
