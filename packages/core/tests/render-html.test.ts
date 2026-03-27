import { Fragment, File, Resource, Form } from '../src/jsx-runtime.js';
import type { TemplateNode, TemplateChild } from '../src/jsx-runtime.js';
import { renderHtml, wrapHtmlDocument } from '../src/template/render-html.js';
import { renderTemplate } from '../src/template/render.js';

function node(
  type: any,
  props: Record<string, unknown>,
  ...children: TemplateChild[]
): TemplateNode {
  return { type, props, children };
}

describe('renderHtml', () => {
  describe('HTML elements', () => {
    it('renders a div with text content', () => {
      const tree = node('div', {}, 'Hello');
      expect(renderHtml(tree)).toBe('<div>Hello</div>');
    });

    it('renders nested elements', () => {
      const tree = node('div', {}, node('span', {}, 'inner'));
      expect(renderHtml(tree)).toBe('<div><span>inner</span></div>');
    });

    it('renders attributes', () => {
      const tree = node('a', { href: '/test', id: 'link1' }, 'Click');
      expect(renderHtml(tree)).toBe('<a href="/test" id="link1">Click</a>');
    });

    it('renders void elements as self-closing', () => {
      const tree = node('input', { type: 'text', name: 'email' });
      expect(renderHtml(tree)).toBe('<input type="text" name="email">');
    });

    it('renders br as self-closing', () => {
      expect(renderHtml(node('br', {}))).toBe('<br>');
    });

    it('renders img as self-closing with attributes', () => {
      const tree = node('img', { src: '/photo.jpg', alt: 'Photo' });
      expect(renderHtml(tree)).toBe('<img src="/photo.jpg" alt="Photo">');
    });
  });

  describe('prop aliases', () => {
    it('converts className to class', () => {
      const tree = node('div', { className: 'wrapper' }, 'content');
      expect(renderHtml(tree)).toBe('<div class="wrapper">content</div>');
    });

    it('converts htmlFor to for', () => {
      const tree = node('label', { htmlFor: 'name' }, 'Name');
      expect(renderHtml(tree)).toBe('<label for="name">Name</label>');
    });
  });

  describe('boolean attributes', () => {
    it('renders boolean true as attribute name only', () => {
      const tree = node('input', { type: 'checkbox', checked: true });
      expect(renderHtml(tree)).toBe('<input type="checkbox" checked>');
    });

    it('omits boolean false attributes', () => {
      const tree = node('input', { type: 'text', disabled: false });
      expect(renderHtml(tree)).toBe('<input type="text">');
    });

    it('renders required attribute', () => {
      const tree = node('input', { type: 'email', required: true });
      expect(renderHtml(tree)).toBe('<input type="email" required>');
    });
  });

  describe('style objects', () => {
    it('converts style object to CSS string', () => {
      const tree = node(
        'div',
        { style: { color: 'red', fontSize: '16px' } },
        'styled'
      );
      expect(renderHtml(tree)).toBe(
        '<div style="color:red;font-size:16px">styled</div>'
      );
    });
  });

  describe('escaping', () => {
    it('escapes HTML in text content', () => {
      const tree = node('div', {}, '<script>alert("xss")</script>');
      expect(renderHtml(tree)).toBe(
        '<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>'
      );
    });

    it('escapes quotes in attribute values', () => {
      const tree = node('div', { title: 'say "hello"' });
      expect(renderHtml(tree)).toBe(
        '<div title="say &quot;hello&quot;"></div>'
      );
    });

    it('escapes ampersands in text', () => {
      const tree = node('span', {}, 'A & B');
      expect(renderHtml(tree)).toBe('<span>A &amp; B</span>');
    });
  });

  describe('null/undefined/boolean handling', () => {
    it('omits null attributes', () => {
      const tree = node('div', { id: null, className: 'test' }, 'content');
      expect(renderHtml(tree)).toBe('<div class="test">content</div>');
    });

    it('omits undefined attributes', () => {
      const tree = node('div', { id: undefined }, 'content');
      expect(renderHtml(tree)).toBe('<div>content</div>');
    });

    it('renders null children as empty', () => {
      expect(renderHtml(null)).toBe('');
    });

    it('renders undefined children as empty', () => {
      expect(renderHtml(undefined)).toBe('');
    });

    it('renders boolean children as empty', () => {
      expect(renderHtml(true)).toBe('');
      expect(renderHtml(false)).toBe('');
    });

    it('renders numbers', () => {
      expect(renderHtml(42)).toBe('42');
    });
  });

  describe('Fragment', () => {
    it('renders children without wrapper', () => {
      const tree = node(Fragment, {}, 'A', 'B', 'C');
      expect(renderHtml(tree)).toBe('ABC');
    });

    it('renders nested fragments', () => {
      const tree = node(Fragment, {}, node(Fragment, {}, 'inner'));
      expect(renderHtml(tree)).toBe('inner');
    });
  });

  describe('wrapHtmlDocument', () => {
    it('wraps body in HTML document', () => {
      const html = wrapHtmlDocument('<h1>Hello</h1>', { title: 'Test' });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test</title>');
      expect(html).toContain('<h1>Hello</h1>');
      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('</html>');
    });

    it('includes CSS when provided', () => {
      const html = wrapHtmlDocument('content', {
        title: 'Styled',
        css: 'body { color: red; }',
      });
      expect(html).toContain('<style>body { color: red; }</style>');
    });

    it('renders without title', () => {
      const html = wrapHtmlDocument('content');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).not.toContain('<title>');
    });
  });

  describe('Form component', () => {
    it('renders form with injected formAction', () => {
      const tree = node(Form, {}, node('input', { type: 'text' }));
      const html = renderHtml(tree, { formAction: '/submit?token=abc' });
      expect(html).toBe(
        '<form method="POST" action="/submit?token=abc"><input type="text"></form>'
      );
    });

    it('renders form without action when no formAction in context', () => {
      const tree = node(Form, {}, 'content');
      const html = renderHtml(tree);
      expect(html).toBe('<form method="POST">content</form>');
    });

    it('preserves additional form props', () => {
      const tree = node(Form, { className: 'my-form', id: 'main' }, 'content');
      const html = renderHtml(tree, { formAction: '/submit' });
      expect(html).toContain('class="my-form"');
      expect(html).toContain('id="main"');
      expect(html).toContain('action="/submit"');
    });
  });

  describe('function components', () => {
    it('renders sync function components', () => {
      const Badge = (props: any) =>
        node('span', { className: 'badge' }, props.text);
      const tree = node(Badge, { text: 'New' });
      expect(renderHtml(tree)).toBe('<span class="badge">New</span>');
    });

    it('throws on async function components', () => {
      const AsyncComp = async () => 'loaded';
      const tree = node(AsyncComp, {});
      expect(() => renderHtml(tree)).toThrow(
        'Async function components are not supported'
      );
    });
  });

  describe('File and Resource components', () => {
    it('throws on File', () => {
      const tree = node(File, { name: 'test.txt' });
      expect(() => renderHtml(tree)).toThrow(
        '<File> elements are not supported in HTML pages'
      );
    });

    it('throws on Resource', () => {
      const tree = node(Resource, { name: 'guide' });
      expect(() => renderHtml(tree)).toThrow(
        '<Resource> elements are not supported in HTML pages'
      );
    });
  });

  describe('arrays', () => {
    it('renders array children', () => {
      const items = ['A', 'B', 'C'];
      const tree = node('ul', {}, ...items.map((item) => node('li', {}, item)));
      expect(renderHtml(tree)).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
    });
  });
});

describe('prompt renderer guards against HTML elements', () => {
  it('throws when HTML element is used in renderTemplate', async () => {
    const tree: TemplateNode = {
      type: 'div',
      props: {},
      children: ['content'],
    };
    await expect(renderTemplate(tree)).rejects.toThrow(
      'HTML elements (<div>) cannot be used in prompt templates'
    );
  });
});
