import { generatePageHtml } from '../src/ui/generate-page-html.js';
import type { Placement } from '../src/ui/types.js';

describe('generatePageHtml', () => {
  const mockComponentBundle = `
    window.PositronicComponents = {
      Form: function(props) { return React.createElement('form', props); },
      Input: function(props) { return React.createElement('input', props); },
    };
  `;

  it('should generate valid HTML with all required elements', () => {
    const placements: Placement[] = [
      { id: 'form-1', component: 'Form', props: {}, parentId: null },
      { id: 'input-1', component: 'Input', props: { name: 'email', label: 'Email' }, parentId: 'form-1' },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'form-1',
      data: { user: { name: 'John' } },
      componentBundle: mockComponentBundle,
      title: 'Test Page',
    });

    // Check basic HTML structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Test Page</title>');

    // Check React/ReactDOM CDN
    expect(html).toContain('https://unpkg.com/react@18/umd/react.production.min.js');
    expect(html).toContain('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');

    // Check Tailwind CDN
    expect(html).toContain('https://cdn.tailwindcss.com');

    // Check component bundle is included
    expect(html).toContain('window.PositronicComponents');

    // Check data is embedded
    expect(html).toContain('window.__POSITRONIC_DATA__');
    expect(html).toContain('"user"');
    expect(html).toContain('"John"');

    // Check placements are embedded
    expect(html).toContain('window.__POSITRONIC_TREE__');
    expect(html).toContain('"form-1"');
    expect(html).toContain('"input-1"');

    // Check root ID is embedded
    expect(html).toContain('window.__POSITRONIC_ROOT__');

    // Check bootstrap runtime is included
    expect(html).toContain('function resolveBinding');
    expect(html).toContain('function buildElement');
  });

  it('should escape HTML in title', () => {
    const placements: Placement[] = [
      { id: 'root', component: 'Form', props: {}, parentId: null },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'root',
      data: {},
      componentBundle: mockComponentBundle,
      title: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should safely serialize data with special characters', () => {
    const placements: Placement[] = [
      { id: 'root', component: 'Form', props: {}, parentId: null },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'root',
      data: { html: '<script>alert("xss")</script>' },
      componentBundle: mockComponentBundle,
    });

    // Script tags in data should be escaped
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('\\u003cscript\\u003e');
  });

  it('should include form action when provided', () => {
    const placements: Placement[] = [
      { id: 'form-1', component: 'Form', props: {}, parentId: null },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'form-1',
      data: {},
      componentBundle: mockComponentBundle,
      formAction: '/api/submit',
    });

    expect(html).toContain('window.__POSITRONIC_FORM_ACTION__');
    expect(html).toContain('/api/submit');
  });

  it('should use default title when not provided', () => {
    const placements: Placement[] = [
      { id: 'root', component: 'Form', props: {}, parentId: null },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'root',
      data: {},
      componentBundle: mockComponentBundle,
    });

    expect(html).toContain('<title>Generated Page</title>');
  });

  it('should preserve data binding syntax in props', () => {
    const placements: Placement[] = [
      { id: 'root', component: 'Form', props: {}, parentId: null },
      {
        id: 'input-1',
        component: 'Input',
        props: { name: 'email', defaultValue: '{{user.email}}' },
        parentId: 'root',
      },
    ];

    const html = generatePageHtml({
      placements,
      rootId: 'root',
      data: { user: { email: 'test@example.com' } },
      componentBundle: mockComponentBundle,
    });

    // Binding syntax should be preserved in placements
    expect(html).toContain('{{user.email}}');
  });
});
