interface TypeCheckResult {
  success: boolean;
  errors?: string;
}

interface BundleResult {
  success: boolean;
  js?: string;
  errors?: string;
}

interface FormValidationResult {
  success: boolean;
  errors?: string;
}

interface PageBundle {
  js: string;
  css: string;
}

interface BuildBundleResult {
  success: boolean;
  bundle?: PageBundle;
  errors?: string;
}

type FormConfig = {
  action: string;
  method: string;
  token?: string;
};

export type RenderPage = (params: {
  data: unknown;
  formConfig?: FormConfig;
}) => string;

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
  dataShape: string
): Promise<TypeCheckResult> {
  await sandbox.writeFile('/workspace/types.ts', dataShape);

  const result = await sandbox.exec('npx tsc --noEmit');

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
  fieldNames: string[],
  data: Record<string, unknown>
): Promise<FormValidationResult> {
  // Bundle component with external React for JSDOM testing
  const bundleResult = await bundle(sandbox, 'external-react');
  if (!bundleResult.success) {
    return { success: false, errors: bundleResult.errors };
  }

  // Write input data and field names for the pre-baked test-form.mjs script (see Dockerfile)
  await Promise.all([
    sandbox.writeFile('/workspace/test-data.json', JSON.stringify(data)),
    sandbox.writeFile(
      '/workspace/field-names.json',
      JSON.stringify(fieldNames)
    ),
  ]);

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

export async function buildBundle(
  sandbox: SandboxInstance
): Promise<BuildBundleResult> {
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

  return {
    success: true,
    bundle: { js: jsFile.content, css: cssFile.content },
  };
}

// Escape `<` in JSON so `</script>` inside a string value can't close the inline script tag.
function safeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function makeRender(bundle: PageBundle): RenderPage {
  return ({ data, formConfig }) => {
    const formScript = formConfig
      ? `<script>window.__POSITRONIC_FORM_CONFIG__ = ${safeInlineJson(
          formConfig
        )};</script>`
      : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${bundle.css}</style>
</head>
<body>
  <div id="root"></div>
  <script>window.__POSITRONIC_DATA__ = ${safeInlineJson(data)};</script>
  ${formScript}
  <script>${bundle.js}</script>
</body>
</html>`;
  };
}
