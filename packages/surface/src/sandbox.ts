export interface TypeCheckResult {
  success: boolean;
  errors?: string;
}

export interface BundleResult {
  success: boolean;
  js?: string;
  errors?: string;
}

export interface FormValidationResult {
  success: boolean;
  errors?: string;
}

export interface BuildHtmlResult {
  success: boolean;
  html?: string;
  errors?: string;
}

export type SandboxInstance = {
  writeFile: (path: string, content: string) => Promise<unknown>;
  readFile: (path: string) => Promise<{ content: string }>;
  exec: (
    command: string,
    options?: { timeout?: number }
  ) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
};

function parseErrors(result: { stdout: string; stderr: string }) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

export async function typeCheck(
  sandbox: SandboxInstance,
  dataShape: string,
  formSchema?: string
): Promise<TypeCheckResult> {
  await sandbox.writeFile('/workspace/types.ts', dataShape);

  if (formSchema) {
    await sandbox.writeFile('/workspace/form-schema.ts', formSchema);
  }

  const result = await sandbox.exec('npx tsc --noEmit');

  if (result.success) {
    return { success: true };
  }

  return { success: false, errors: parseErrors(result) };
}

export async function typeCheckData(
  sandbox: SandboxInstance,
  json: string,
  dataShape: string
): Promise<TypeCheckResult> {
  await sandbox.writeFile('/workspace/types.ts', dataShape);
  await sandbox.writeFile(
    '/workspace/data-check.ts',
    `import type { Data } from './types';\nconst data: Data = ${json};`
  );
  const result = await sandbox.exec(
    'npx tsc --noEmit --strict /workspace/data-check.ts'
  );
  if (result.success) {
    return { success: true };
  }
  return { success: false, errors: parseErrors(result) };
}

export async function bundle(
  sandbox: SandboxInstance,
  mode: 'inline' | 'external-react' = 'external-react'
): Promise<BundleResult> {
  const externals =
    mode === 'external-react' ? ' --external:react --external:react-dom' : '';

  const result = await sandbox.exec(
    `esbuild /workspace/component.tsx --bundle --format=esm --jsx=automatic${externals} --outfile=/workspace/component.bundle.js --loader:.tsx=tsx`
  );

  if (!result.success) {
    return { success: false, errors: parseErrors(result) };
  }

  const file = await sandbox.readFile('/workspace/component.bundle.js');
  return { success: true, js: file.content };
}

export async function validateForm(
  sandbox: SandboxInstance,
  formSchemaSource: string,
  data: Record<string, unknown>
): Promise<FormValidationResult> {
  // Bundle component with external React for JSDOM testing
  const bundleResult = await bundle(sandbox, 'external-react');
  if (!bundleResult.success) {
    return { success: false, errors: bundleResult.errors };
  }

  // Write form schema as .ts, then use esbuild to strip types to .mjs
  await sandbox.writeFile('/workspace/form-schema.ts', formSchemaSource);
  await sandbox.exec(
    'esbuild /workspace/form-schema.ts --format=esm --outfile=/workspace/form-schema.mjs'
  );

  // Write input data for the pre-baked test-form.mjs script (see Dockerfile)
  await sandbox.writeFile('/workspace/test-data.json', JSON.stringify(data));

  const result = await sandbox.exec(
    'node --experimental-vm-modules /workspace/test-form.mjs',
    { timeout: 30000 }
  );

  if (result.success) {
    return { success: true };
  }

  // Try to parse structured output from stdout
  const stdout = result.stdout.trim();
  try {
    const parsed = JSON.parse(stdout);
    return {
      success: false,
      errors: parsed.errors?.join('\n') || 'Form validation failed',
    };
  } catch {
    return { success: false, errors: parseErrors(result) };
  }
}

export async function buildHtml(
  sandbox: SandboxInstance,
  data: Record<string, unknown>
): Promise<BuildHtmlResult> {
  const bundleResult = await sandbox.exec(
    'esbuild /workspace/mount.tsx --bundle --format=iife --jsx=automatic --outfile=/workspace/page.bundle.js --loader:.tsx=tsx'
  );

  if (!bundleResult.success) {
    return { success: false, errors: parseErrors(bundleResult) };
  }

  const cssResult = await sandbox.exec(
    'npx @tailwindcss/cli -i /workspace/tailwind.css -o /workspace/page.css --content "/workspace/component.tsx,/workspace/surface/components/*.tsx" --minify'
  );

  if (!cssResult.success) {
    return { success: false, errors: parseErrors(cssResult) };
  }

  const [jsFile, cssFile] = await Promise.all([
    sandbox.readFile('/workspace/page.bundle.js'),
    sandbox.readFile('/workspace/page.css'),
  ]);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${cssFile.content}</style>
</head>
<body>
  <div id="root"></div>
  <script>window.__POSITRONIC_DATA__ = ${JSON.stringify(data)};</script>
  <script>${jsFile.content}</script>
</body>
</html>`;

  return { success: true, html };
}
