import type { SandboxInstance } from './sandbox.js';
import type { Section } from './section-subagent.js';

/**
 * Deterministically compose approved section components into a single
 * /workspace/component.tsx. Pure template application — no LLM call.
 *
 * Assumes each section's TSX has already been written to
 * /workspace/sections/<name>.tsx by its sub-agent. Emits a default export
 * Page component that imports each section and renders
 * `<SectionName data={data} />` in the order the sections were dispatched.
 * The outer page wrapper is intentionally minimal — just a flex column
 * container — so cohesion concerns (vertical rhythm, shared spacing) are
 * resolved per-section or reviewed by the orchestrator at the whole-page
 * pass, not encoded in the knit template.
 */
export async function knitSections(
  sandbox: SandboxInstance,
  sections: Section[]
): Promise<void> {
  const imports = sections
    .map(
      (s) => `import ${toPascalCase(s.name)} from './sections/${s.name}.tsx';`
    )
    .join('\n');

  const body = sections
    .map((s) => `      <${toPascalCase(s.name)} data={data} />`)
    .join('\n');

  const source = `${imports}

interface Props {
  data: any;
}

export default function Page({ data }: Props) {
  return (
    <div className="flex flex-col">
${body}
    </div>
  );
}
`;

  await sandbox.writeFile('/workspace/component.tsx', source);
}

function toPascalCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
