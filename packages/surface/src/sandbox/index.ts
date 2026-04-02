import { typeCheck, type TypeCheckResult } from './type-check.js';
import { bundle, type BundleResult } from './bundle.js';
import { validateForm, type FormValidationResult } from './validate-form.js';
import { buildHtml, type BuildHtmlResult } from './build-html.js';

export type {
  TypeCheckResult,
  BundleResult,
  FormValidationResult,
  BuildHtmlResult,
};

type SandboxInstance = {
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

export interface SurfaceSandbox {
  typeCheck(
    source: string,
    dataShape: string,
    formSchema?: string
  ): Promise<TypeCheckResult>;

  typeCheckData(json: string, dataShape: string): Promise<TypeCheckResult>;

  bundle(mode?: 'inline' | 'external-react'): Promise<BundleResult>;

  validateForm(formSchema: string): Promise<FormValidationResult>;

  buildHtml(data: Record<string, unknown>): Promise<BuildHtmlResult>;
}

/**
 * Create a SurfaceSandbox interface from a Cloudflare Sandbox instance.
 *
 * Operations are sequential: typeCheck writes the component, bundle reads it,
 * validateForm uses the bundle output, buildHtml produces the final page.
 */
export function createSurfaceSandbox(sandbox: SandboxInstance): SurfaceSandbox {
  return {
    typeCheck: (source, dataShape, formSchema) =>
      typeCheck(sandbox, source, dataShape, formSchema),

    async typeCheckData(json: string, dataShape: string) {
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
      const errors = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .trim();
      return { success: false, errors };
    },

    bundle: (mode) => bundle(sandbox, mode),

    validateForm: (formSchema) => validateForm(sandbox, formSchema),

    buildHtml: (data) => buildHtml(sandbox, data),
  };
}
