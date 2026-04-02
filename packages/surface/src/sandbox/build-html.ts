export interface BuildHtmlResult {
  success: boolean;
  html?: string;
  errors?: string;
}

/**
 * Build a self-contained HTML page from the component in the sandbox.
 *
 * 1. Bundles the component + mount script with React inlined (esbuild)
 * 2. Generates Tailwind CSS for the classes used
 * 3. Assembles everything into a single HTML string
 *
 * The component must already be written to the sandbox (via typeCheck).
 */
export async function buildHtml(
  sandbox: {
    exec: (command: string) => Promise<{
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
    readFile: (path: string) => Promise<{ content: string }>;
    writeFile: (path: string, content: string) => Promise<unknown>;
  },
  data: Record<string, unknown>
): Promise<BuildHtmlResult> {
  // Bundle with React inlined (mount.tsx imports component.tsx)
  const bundleResult = await sandbox.exec(
    'esbuild /workspace/mount.tsx --bundle --format=iife --jsx=automatic --outfile=/workspace/page.bundle.js --loader:.tsx=tsx'
  );

  if (!bundleResult.success) {
    const errors = [bundleResult.stdout, bundleResult.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    return { success: false, errors };
  }

  // Generate Tailwind CSS (scans component + surface components for classes)
  const cssResult = await sandbox.exec(
    'npx @tailwindcss/cli -i /workspace/tailwind.css -o /workspace/page.css --content "/workspace/component.tsx,/workspace/surface/components/*.tsx" --minify'
  );

  if (!cssResult.success) {
    const errors = [cssResult.stdout, cssResult.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    return { success: false, errors };
  }

  // Read the bundled JS and CSS
  const [jsFile, cssFile] = await Promise.all([
    sandbox.readFile('/workspace/page.bundle.js'),
    sandbox.readFile('/workspace/page.css'),
  ]);

  // Assemble the HTML
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
