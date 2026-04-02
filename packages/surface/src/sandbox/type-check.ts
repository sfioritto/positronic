export interface TypeCheckResult {
  success: boolean;
  errors?: string;
}

/**
 * Write a TSX component to the sandbox and run tsc --noEmit to type-check it.
 *
 * The sandbox must have the surface components and tsconfig pre-installed
 * (via the Dockerfile).
 *
 * @param sandbox - Cloudflare Sandbox instance
 * @param source - The TSX component source code
 * @param dataShape - TypeScript interface for the component's data prop
 * @param formSchema - Optional Zod schema source for form validation types
 */
export async function typeCheck(
  sandbox: {
    writeFile: (path: string, content: string) => Promise<unknown>;
    exec: (command: string) => Promise<{
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  },
  source: string,
  dataShape: string,
  formSchema?: string
): Promise<TypeCheckResult> {
  // Write the data shape types
  await sandbox.writeFile('/workspace/types.ts', dataShape);

  // Write form schema if provided
  if (formSchema) {
    await sandbox.writeFile('/workspace/form-schema.ts', formSchema);
  }

  // Write the component
  await sandbox.writeFile('/workspace/component.tsx', source);

  // Run tsc
  const result = await sandbox.exec('npx tsc --noEmit');

  if (result.success) {
    return { success: true };
  }

  // Combine stdout and stderr for error output — tsc writes errors to stdout
  const errors = [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim();
  return { success: false, errors };
}
