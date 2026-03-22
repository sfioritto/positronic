import { Fragment, File, Resource } from '../src/jsx-runtime.js';
import type { TemplateNode, TemplateChild } from '../src/jsx-runtime.js';
import {
  renderTemplate,
  isTemplateNode,
  resolveTemplate,
} from '../src/template/render.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { ObjectGenerator } from '../src/clients/types.js';
import { finalStateFromEvents } from './brain-test-helpers.js';

// Helper to build TemplateNode trees (simulates what jsx/jsxs produce)
function node(
  type: typeof Fragment | typeof File | typeof Resource | ((props: any) => any),
  props: Record<string, unknown>,
  ...children: TemplateChild[]
): TemplateNode {
  return { type, props, children };
}

describe('renderTemplate', () => {
  it('renders a fragment with string children', async () => {
    const tree = node(Fragment, {}, 'Hello ', 'world');
    expect(await renderTemplate(tree)).toBe('Hello world');
  });

  it('renders nested fragments', async () => {
    const tree = node(Fragment, {}, 'A', node(Fragment, {}, 'B', 'C'), 'D');
    expect(await renderTemplate(tree)).toBe('ABCD');
  });

  it('skips null, undefined, boolean children', async () => {
    const tree = node(
      Fragment,
      {},
      'Hello',
      null,
      undefined,
      true,
      false,
      ' world'
    );
    expect(await renderTemplate(tree)).toBe('Hello world');
  });

  it('renders number children as strings', async () => {
    const tree = node(Fragment, {}, 'Count: ', 42);
    expect(await renderTemplate(tree)).toBe('Count: 42');
  });

  it('renders sync function components', async () => {
    const Greeting = (props: any) => `Hello, ${props.name}!`;
    const tree = node(Greeting, { name: 'World' });
    expect(await renderTemplate(tree)).toBe('Hello, World!');
  });

  it('renders async function components', async () => {
    const AsyncComponent = async (props: any) => `Loaded: ${props.data}`;
    const tree = node(AsyncComponent, { data: 'test' });
    expect(await renderTemplate(tree)).toBe('Loaded: test');
  });

  it('renders function components that return TemplateNode trees', async () => {
    const Wrapper = (props: any) =>
      node(Fragment, {}, 'Before ', ...props.children, ' After');
    const tree = node(Wrapper, {}, 'Content');
    expect(await renderTemplate(tree)).toBe('Before Content After');
  });

  it('renders arrays from .map() calls', async () => {
    const items = ['A', 'B', 'C'];
    const tree = node(
      Fragment,
      {},
      'Items:\n',
      items.map((i) => `- ${i}\n`)
    );
    expect(await renderTemplate(tree)).toBe('Items:\n- A\n- B\n- C');
  });

  it('handles deeply nested structures', async () => {
    const Section = (props: any) =>
      node(Fragment, {}, `[${props.title}] `, ...props.children);
    const tree = node(
      Fragment,
      {},
      node(Section, { title: 'Intro' }, 'Welcome'),
      '\n',
      node(Section, { title: 'Body' }, 'Content')
    );
    expect(await renderTemplate(tree)).toBe('[Intro] Welcome\n[Body] Content');
  });

  it('auto-dedents indented text', async () => {
    const tree = node(
      Fragment,
      {},
      '\n    Line one\n    Line two\n    Line three\n  '
    );
    expect(await renderTemplate(tree)).toBe('Line one\nLine two\nLine three');
  });

  it('handles plain strings without indentation', async () => {
    expect(await renderTemplate('hello world')).toBe('hello world');
  });

  it('handles empty fragments', async () => {
    const tree = node(Fragment, {});
    expect(await renderTemplate(tree)).toBe('');
  });

  it('renders conditionals (false branch produces nothing)', async () => {
    const showExtra = false;
    const tree = node(
      Fragment,
      {},
      'Main content',
      showExtra && node(Fragment, {}, '\nExtra content')
    );
    expect(await renderTemplate(tree)).toBe('Main content');
  });

  it('renders conditionals (true branch produces content)', async () => {
    const showExtra = true;
    const tree = node(
      Fragment,
      {},
      'Main content',
      showExtra && node(Fragment, {}, '\nExtra content')
    );
    expect(await renderTemplate(tree)).toBe('Main content\nExtra content');
  });
});

describe('isTemplateNode', () => {
  it('returns true for TemplateNode objects', () => {
    expect(isTemplateNode(node(Fragment, {}))).toBe(true);
  });

  it('returns true for function component nodes', () => {
    const Comp = () => 'hello';
    expect(isTemplateNode(node(Comp, {}))).toBe(true);
  });

  it('returns false for strings', () => {
    expect(isTemplateNode('hello')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTemplateNode(null)).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isTemplateNode(42)).toBe(false);
  });

  it('returns false for plain objects missing required fields', () => {
    expect(isTemplateNode({ type: Fragment })).toBe(false);
    expect(isTemplateNode({ props: {} })).toBe(false);
  });
});

describe('resolveTemplate', () => {
  it('passes strings through unchanged', async () => {
    expect(await resolveTemplate('hello')).toBe('hello');
  });

  it('renders TemplateNode to string', async () => {
    const tree = node(Fragment, {}, 'hello');
    expect(await resolveTemplate(tree)).toBe('hello');
  });

  it('handles null/undefined by returning empty string', async () => {
    expect(await resolveTemplate(null as any)).toBe('');
    expect(await resolveTemplate(undefined as any)).toBe('');
  });
});

describe('brain integration with JSX templates', () => {
  const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
  const mockClient: jest.Mocked<ObjectGenerator> = {
    generateObject: mockGenerateObject,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prompt step renders TemplateNode from template function', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { result: 'analyzed' },
    } as any);

    const testBrain = brain('jsx-prompt-test').prompt('Ask', () => ({
      message: node(
        Fragment,
        {},
        'Analyze the following:\n',
        'Topic: test-topic\n',
        'Please provide insights.'
      ),
      outputSchema: z.object({ result: z.string() }),
    }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test' },
    })) {
      events.push(event);
    }

    // Verify the prompt was rendered to a string
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Analyze the following:'),
      })
    );
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Topic: test-topic'),
      })
    );

    // Verify state was updated (results spread flat onto state)
    const finalState = finalStateFromEvents(events);
    expect(finalState.result).toEqual('analyzed');
  });

  it('prompt step still works with plain string templates', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { answer: 'yes' },
    } as any);

    const testBrain = brain('string-prompt-test').prompt('Ask', () => ({
      message: 'Is this working?',
      outputSchema: z.object({ answer: z.string() }),
    }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test' },
    })) {
      events.push(event);
    }

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Is this working?',
      })
    );
  });

  it('template with async function component resolves correctly', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { summary: 'done' },
    } as any);

    const AsyncContent = async () => 'loaded content from resource';

    const testBrain = brain('async-component-test').prompt('Summarize', () => ({
      message: node(Fragment, {}, 'Summarize this:\n', node(AsyncContent, {})),
      outputSchema: z.object({ summary: z.string() }),
    }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test' },
    })) {
      events.push(event);
    }

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('loaded content from resource'),
      })
    );
  });

  it('renders <File> node via TemplateContext.readFile', async () => {
    const tree = node(
      Fragment,
      {},
      'Content: ',
      node(File, { name: 'report.txt' })
    );
    const result = await renderTemplate(tree, {
      readFile: async (name) => `file:${name}`,
    });
    expect(result).toBe('Content: file:report.txt');
  });

  it('renders <Resource> node via TemplateContext.readResource', async () => {
    const tree = node(
      Fragment,
      {},
      'Rules: ',
      node(Resource, { name: 'guidelines' })
    );
    const result = await renderTemplate(tree, {
      readResource: async (name) => `resource:${name}`,
    });
    expect(result).toBe('Rules: resource:guidelines');
  });

  it('throws when <File> is used without readFile in context', async () => {
    const tree = node(File, { name: 'report.txt' });
    await expect(renderTemplate(tree, {})).rejects.toThrow(
      '<File> requires a files service'
    );
  });

  it('resolves <File> and <Resource> through full brain execution', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { summary: 'done' },
    } as any);

    const files = {
      open: (name: string) => ({
        read: async () => `content of ${name}`,
      }),
    };

    const resources = {
      loadText: async (name: string) => `resource: ${name}`,
    };

    const testBrain = brain('file-resource-template-test').prompt(
      'Analyze',
      () => ({
        message: node(
          Fragment,
          {},
          node(Resource, { name: 'guidelines' }),
          '\n',
          node(File, { name: 'transcript.txt' })
        ),
        outputSchema: z.object({ summary: z.string() }),
      })
    );

    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test' },
      providers: { files: () => files as any },
      resources: resources as any,
    })) {
      // collect events
    }

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('content of transcript.txt'),
      })
    );
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('resource: guidelines'),
      })
    );
  });

  it('resolves FileHandle attachments to Attachment objects in .prompt()', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { answer: 'analyzed' },
    } as any);

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header
    const files = {
      open: (name: string) => ({
        name,
        url: '',
        read: async () => 'text',
        readBytes: async () => pdfBytes,
        write: async () => ({ name }),
        exists: async () => true,
        delete: async () => {},
      }),
      write: async () => ({ name: '' }),
      list: async () => [],
      delete: async () => {},
      zip: () => ({
        write: async () => {},
        finalize: async () => ({ name: '' }),
      }),
    };

    const testBrain = brain('attachment-test').prompt(
      'Analyze PDF',
      ({ files: f }) => ({
        message: 'Analyze the attached document.',
        attachments: [f!.open('report.pdf')],
        outputSchema: z.object({ answer: z.string() }),
      })
    );

    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test' },
      providers: { files: () => files as any },
    })) {
      // collect
    }

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Analyze the attached document.',
        attachments: [
          expect.objectContaining({
            name: 'report.pdf',
            mimeType: 'application/pdf',
            data: pdfBytes,
          }),
        ],
      })
    );
  });
});
