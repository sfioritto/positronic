/**
 * Reads markdown skill files and generates a TypeScript module
 * that exports them as string constants. Run before tsc/swc.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(dir, '..', 'src', 'skills');
const outFile = join(dir, '..', 'src', 'skills-generated.ts');

function readSkill(path: string) {
  return readFileSync(join(skillsDir, path), 'utf-8');
}

function escapeForTemplate(content: string) {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

const files = {
  SHADCN_SKILL: 'SKILL.md',
  SHADCN_RULES_STYLING: 'rules/styling.md',
  SHADCN_RULES_COMPOSITION: 'rules/composition.md',
  SHADCN_RULES_FORMS: 'rules/forms.md',
  SHADCN_RULES_ICONS: 'rules/icons.md',
  SHADCN_RULES_BASE_VS_RADIX: 'rules/base-vs-radix.md',
  SHADCN_CUSTOMIZATION: 'customization.md',
};

const exports = Object.entries(files)
  .map(([name, path]) => {
    const content = escapeForTemplate(readSkill(path));
    return `export const ${name} = \`${content}\`;`;
  })
  .join('\n\n');

const output = `/**
 * Auto-generated from shadcn skill markdown files.
 * Do not edit — run \`npm run build:skills\` to regenerate.
 */

${exports}

/**
 * All skill docs concatenated for injection into LLM system prompts.
 */
export const ALL_SKILL_DOCS = [
  SHADCN_SKILL,
  SHADCN_RULES_STYLING,
  SHADCN_RULES_COMPOSITION,
  SHADCN_RULES_FORMS,
  SHADCN_RULES_ICONS,
  SHADCN_CUSTOMIZATION,
].join('\\n\\n---\\n\\n');
`;

writeFileSync(outFile, output, 'utf-8');
console.log(`Generated ${outFile}`);
