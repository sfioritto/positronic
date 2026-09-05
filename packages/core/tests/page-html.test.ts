import { describe, it, expect } from 'vitest';
import type { Spec } from '@json-render/core';
import { generatePageHtml, generateFormToken } from '../src/page/page-html.js';

const spec: Spec = {
  root: 'page',
  elements: {
    page: { type: 'Stack', props: {}, children: ['email'] },
    email: {
      type: 'Input',
      props: { name: 'email', value: { $bindState: '/form/email' } },
      children: [],
    },
  },
  state: { user: { name: 'John' } },
};

describe('generatePageHtml', () => {
  it('embeds the spec for the component bundle to render', () => {
    const html = generatePageHtml({
      spec,
      title: 'Test Page',
      formAction: '/api/submit?token=abc',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test Page</title>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(
      '<link rel="stylesheet" href="/bundle/components.css">'
    );
    expect(html).toContain('<script src="/bundle/components.js"></script>');

    const embedded = html.match(/window\.__POSITRONIC_PAGE__ = (.*);/);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded![1])).toEqual({
      title: 'Test Page',
      spec,
      formAction: '/api/submit?token=abc',
    });

    // The page no longer depends on CDNs
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('cdn.tailwindcss.com');
  });

  it('defaults the title and leaves formAction null for read-only pages', () => {
    const html = generatePageHtml({ spec });

    expect(html).toContain('<title>Generated Page</title>');
    expect(html).toContain('"formAction":null');
  });

  it('escapes HTML in the title', () => {
    const html = generatePageHtml({
      spec,
      title: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps script-closing sequences in the spec from ending the script', () => {
    const html = generatePageHtml({
      spec: {
        ...spec,
        state: { html: '</script><script>alert("xss")</script>' },
      },
    });

    expect(html).not.toContain('</script><script>alert');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  describe('generateFormToken', () => {
    it('returns a UUID string', () => {
      expect(generateFormToken()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('returns unique tokens', () => {
      expect(generateFormToken()).not.toBe(generateFormToken());
    });
  });
});
