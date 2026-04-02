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

    bundle: (mode) => bundle(sandbox, mode),

    validateForm: (formSchema) => validateForm(sandbox, formSchema),

    buildHtml: (data) => buildHtml(sandbox, data),
  };
}
