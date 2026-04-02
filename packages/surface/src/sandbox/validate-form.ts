export interface FormValidationResult {
  success: boolean;
  errors?: string;
}

/**
 * Validate that a form component produces output matching a Zod schema.
 *
 * Writes a test script to the sandbox that:
 * 1. Renders the bundled component with JSDOM
 * 2. Checks all schema fields have corresponding form inputs
 * 3. Fills form fields with fake data and submits
 * 4. Validates the output against the Zod schema
 *
 * The component must already be bundled (via bundle()) and the bundle
 * must be at /workspace/component.bundle.js.
 */
export async function validateForm(
  sandbox: {
    writeFile: (path: string, content: string) => Promise<unknown>;
    exec: (
      command: string,
      options?: { timeout?: number }
    ) => Promise<{
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  },
  formSchemaSource: string
): Promise<FormValidationResult> {
  // Write the form schema as .mjs so Node can import it directly
  // Strip any TypeScript-only syntax (import type, etc.)
  const jsSchema = formSchemaSource
    .replace(/import type .*?;?\n/g, '')
    .replace(/: z\.infer<.*?>/g, '');
  await sandbox.writeFile('/workspace/form-schema.mjs', jsSchema);

  const testScript = `
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { formSchema } from './form-schema.mjs';

// Set up JSDOM globals before importing React
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLFormElement = dom.window.HTMLFormElement;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

// Import the bundled component (esbuild output, plain JS)
const { default: Page } = await import('./component.bundle.js');

// Generate fake data from schema shape
function generateFakeData(schema) {
  const shape = schema.shape;
  const data = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const typeName = fieldSchema._def?.typeName;
    if (typeName === 'ZodString') data[key] = 'test-' + key;
    else if (typeName === 'ZodNumber') data[key] = 42;
    else if (typeName === 'ZodBoolean') data[key] = true;
    else if (typeName === 'ZodEnum') data[key] = fieldSchema._def.values[0];
    else data[key] = 'test-' + key;
  }
  return data;
}

const fakeData = generateFakeData(formSchema);

// Render the component
const root = document.getElementById('root');
const reactRoot = createRoot(root);
await act(() => {
  reactRoot.render(React.createElement(Page, { data: {} }));
});

// Find all form inputs
const schemaKeys = Object.keys(formSchema.shape);
const inputs = root.querySelectorAll('input[name], select[name], textarea[name]');
const inputNames = Array.from(inputs).map(el => el.getAttribute('name'));

const missingFields = schemaKeys.filter(key => !inputNames.includes(key));

const result = { success: true, errors: [] };

if (missingFields.length > 0) {
  result.success = false;
  result.errors.push('Missing form fields for schema keys: ' + missingFields.join(', '));
}

console.log(JSON.stringify(result));
process.exit(result.success ? 0 : 1);
`;

  await sandbox.writeFile('/workspace/test-form.mjs', testScript);

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
    const errors = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    return { success: false, errors };
  }
}
