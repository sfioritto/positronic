/**
 * Compiles MDX docs and reads skill markdown files, generating TypeScript modules.
 *
 * 1. Compiles .mdx files in src/docs/ → .js modules (React components)
 * 2. Reads skill markdown files → exports them as string constants
 *
 * Run before tsc/swc via `npm run build:docs`.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { compile } from '@mdx-js/mdx';

const dir = dirname(fileURLToPath(import.meta.url));
const docsDir = join(dir, '..', 'src', 'docs');
const skillsDir = join(dir, '..', 'src', 'skills');

// Step 1: Compile MDX files to JS
const mdxFiles = readdirSync(docsDir).filter((f) => f.endsWith('.mdx'));

for (const file of mdxFiles) {
  const source = readFileSync(join(docsDir, file), 'utf-8');
  const result = await compile(source, {
    outputFormat: 'function-body',
    jsxImportSource: 'react',
  });
  const jsFile = file.replace('.mdx', '.js');
  writeFileSync(join(docsDir, jsFile), String(result), 'utf-8');
  console.log(`Compiled ${file} → ${jsFile}`);
}

// Step 2: Read skill markdown files and generate a TS module
const skillFiles: Record<string, string> = {
  SHADCN_SKILL: 'SKILL.md',
  SHADCN_RULES_STYLING: 'rules/styling.md',
  SHADCN_RULES_COMPOSITION: 'rules/composition.md',
  SHADCN_RULES_FORMS: 'rules/forms.md',
  SHADCN_RULES_ICONS: 'rules/icons.md',
  SHADCN_CUSTOMIZATION: 'customization.md',
};

function escapeForTemplate(content: string) {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

const exports = Object.entries(skillFiles)
  .map(([name, path]) => {
    const content = escapeForTemplate(
      readFileSync(join(skillsDir, path), 'utf-8')
    );
    return `export const ${name} = \`${content}\`;`;
  })
  .join('\n\n');

const skillsOutput = `/**
 * Auto-generated from shadcn skill markdown files.
 * Do not edit — run \`npm run build:docs\` to regenerate.
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

writeFileSync(
  join(dir, '..', 'src', 'skills-generated.ts'),
  skillsOutput,
  'utf-8'
);
console.log('Generated skills-generated.ts');
