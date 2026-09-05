import { describe, it, expect } from 'vitest';
import { catalog } from '../src/catalog.js';
import { components } from '../src/index.js';

describe('catalog', () => {
  it('has a React implementation for every component', () => {
    expect(Object.keys(components).sort()).toEqual(
      [...catalog.componentNames].sort()
    );
  });

  it('tells the model how to bind and submit forms', () => {
    const prompt = catalog.prompt();
    expect(prompt).toContain('/form/<field>');
    expect(prompt).toContain('"submitForm"');
    expect(prompt).toContain('- Checkbox:');
    expect(prompt).toContain('- MultiTextInput:');
    expect(prompt).not.toContain('Dialog');
  });
});
