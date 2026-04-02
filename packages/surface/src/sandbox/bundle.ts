export interface BundleResult {
  success: boolean;
  js?: string;
  errors?: string;
}

/**
 * Bundle the component at /workspace/component.tsx into a single JS file
 * using esbuild in the sandbox.
 *
 * The component must already be written to the sandbox (via typeCheck).
 * esbuild resolves imports against the pre-installed node_modules and
 * surface components.
 *
 * @param mode - 'inline' bundles everything (for final HTML output).
 *               'external-react' externalizes react/react-dom (for JSDOM testing).
 */
export async function bundle(
  sandbox: {
    exec: (command: string) => Promise<{
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
    readFile: (path: string) => Promise<{ content: string }>;
  },
  mode: 'inline' | 'external-react' = 'external-react'
): Promise<BundleResult> {
  const externals =
    mode === 'external-react' ? ' --external:react --external:react-dom' : '';

  const result = await sandbox.exec(
    `esbuild /workspace/component.tsx --bundle --format=esm --jsx=automatic${externals} --outfile=/workspace/component.bundle.js --loader:.tsx=tsx`
  );

  if (!result.success) {
    const errors = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    return { success: false, errors };
  }

  const file = await sandbox.readFile('/workspace/component.bundle.js');
  return { success: true, js: file.content };
}
