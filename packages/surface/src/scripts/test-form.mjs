import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { formSchema } from './form-schema.mjs';

// Set up JSDOM globals before importing React
const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost',
    pretendToBeVisual: true,
  }
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLFormElement = dom.window.HTMLFormElement;

// Polyfill APIs that JSDOM lacks but Radix components need
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

// Import the bundled component (esbuild output, plain JS)
const { default: Page } = await import('./component.bundle.js');

// Input data written by the host
const inputData = JSON.parse(readFileSync('/workspace/test-data.json', 'utf8'));

// Render the component
const root = document.getElementById('root');
const reactRoot = createRoot(root);
await act(() => {
  reactRoot.render(React.createElement(Page, { data: inputData }));
});

// Find all form inputs
const schemaKeys = Object.keys(formSchema.shape);
const inputs = root.querySelectorAll(
  'input[name], select[name], textarea[name]'
);
const inputNames = Array.from(inputs).map((el) => {
  const name = el.getAttribute('name') || '';
  return name.endsWith('[]') ? name.slice(0, -2) : name;
});

const missingFields = schemaKeys.filter((key) => !inputNames.includes(key));

const result = { success: true, errors: [] };

if (missingFields.length > 0) {
  result.success = false;
  result.errors.push(
    'Missing form fields for schema keys: ' + missingFields.join(', ')
  );
}

console.log(JSON.stringify(result));
process.exit(result.success ? 0 : 1);
