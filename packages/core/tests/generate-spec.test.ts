import { vi, describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { generateSpec } from '../src/page/generate-spec.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import { testCatalog, jsonl, element, submitButton } from './page-catalog.js';

const mockStreamText = vi.fn<ObjectGenerator['streamText']>();
const mockClient: ObjectGenerator = {
  generateObject: vi.fn<ObjectGenerator['generateObject']>(),
  streamText: mockStreamText,
};

function respond(text: string, totalTokens = 100) {
  mockStreamText.mockResolvedValueOnce({
    toolCalls: [],
    text,
    usage: { totalTokens },
  });
}

const root = { op: 'add', path: '/root', value: 'page' };

describe('generateSpec', () => {
  beforeEach(() => {
    mockStreamText.mockClear();
  });

  it('compiles the JSONL patches into a spec and seeds state from props', async () => {
    respond(
      jsonl(
        root,
        element('page', 'Stack', {}, { children: ['title', 'list'] }),
        element('title', 'Heading', { text: 'Inbox' }),
        element(
          'list',
          'Stack',
          {},
          { repeat: { statePath: '/emails', key: 'id' }, children: ['row'] }
        ),
        element('row', 'Text', { content: { $item: 'subject' } }),
        // The model invents sample data despite instructions; props must win
        {
          op: 'add',
          path: '/state',
          value: { emails: [{ id: 'fake', subject: 'Fake' }], theme: 'dark' },
        }
      ),
      150
    );
    const emails = [{ id: '1', subject: 'Hello' }];

    const result = await generateSpec({
      client: mockClient,
      prompt: 'Show my inbox',
      catalog: testCatalog,
      props: { emails },
    });

    expect(result.spec.root).toBe('page');
    expect(Object.keys(result.spec.elements)).toEqual([
      'page',
      'title',
      'list',
      'row',
    ]);
    expect(result.spec.state).toEqual({ emails, theme: 'dark' });
    expect(result.repairs).toEqual([]);
    expect(result.usage.totalTokens).toBe(150);

    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const call = mockStreamText.mock.calls[0][0];
    expect(call.system).toContain('AVAILABLE COMPONENTS (7)');
    expect(call.system).toContain('- Checkbox:');
    expect(call.system).toContain('- submitForm:');
    // The prompt describes the shape of props, never their values
    expect(call.prompt).toContain('## State');
    expect(call.prompt).toContain('subject: string');
    expect(call.prompt).not.toContain('Hello');
    expect(call.prompt).toContain('## Instructions\nShow my inbox');
    expect(call.prompt).not.toContain('## Form');
  });

  it('ignores prose and code fences around the patches', async () => {
    respond(
      `Here is the page:\n\`\`\`jsonl\n${jsonl(root, element('page', 'Text', { content: 'Hi' }))}\n\`\`\`\nLet me know!`
    );

    const { spec } = await generateSpec({
      client: mockClient,
      prompt: 'Say hi',
      catalog: testCatalog,
    });

    expect(spec.root).toBe('page');
    expect(spec.elements.page.props).toEqual({ content: 'Hi' });
  });

  it('sends validation issues back as a patch request and applies the fixes', async () => {
    // First attempt references a child that was never added
    respond(
      jsonl(
        root,
        element('page', 'Stack', {}, { children: ['greeting', 'missing'] }),
        element('greeting', 'Text', { content: { $state: '/user/name' } })
      )
    );
    respond(jsonl(element('missing', 'Text', { content: 'Now present' })));
    const props = { user: { name: 'secret-name' } };

    const result = await generateSpec({
      client: mockClient,
      prompt: 'Greet the user',
      catalog: testCatalog,
      props,
    });

    expect(mockStreamText).toHaveBeenCalledTimes(2);
    const repair = mockStreamText.mock.calls[1][0];
    expect(repair.system).toBe(mockStreamText.mock.calls[0][0].system);
    expect(repair.prompt).toContain('references child "missing"');
    // The current spec goes back for patching, without the seeded data
    expect(repair.prompt).toContain('CURRENT UI STATE');
    expect(repair.prompt).toContain('"greeting"');
    expect(repair.prompt).not.toContain('secret-name');

    expect(result.repairs).toEqual([
      [expect.stringContaining('references child "missing"')],
    ]);
    expect(result.spec.elements.missing.props).toEqual({
      content: 'Now present',
    });
    expect(result.spec.state).toEqual(props);
  });

  it('prunes dangling children on the last round instead of failing', async () => {
    respond(
      jsonl(
        root,
        element('page', 'Stack', {}, { children: ['greeting', 'missing'] }),
        element('greeting', 'Text', { content: 'Hi' })
      )
    );
    respond(''); // the model returns nothing useful

    const { spec, repairs } = await generateSpec({
      client: mockClient,
      prompt: 'Greet',
      catalog: testCatalog,
      maxRepairs: 1,
    });

    expect(repairs).toHaveLength(1);
    expect(spec.elements.page.children).toEqual(['greeting']);
  });

  it('fails once the repair rounds are used up', async () => {
    const broken = jsonl(root, element('page', 'Carousel', {}));
    respond(broken);
    respond('');
    respond('');

    await expect(
      generateSpec({
        client: mockClient,
        prompt: 'Spin',
        catalog: testCatalog,
        maxRepairs: 2,
      })
    ).rejects.toThrow(/after 2 repair round\(s\):\n- elements\/page\/type/);
    expect(mockStreamText).toHaveBeenCalledTimes(3);
  });

  it('lists the form fields and requires each to be bound', async () => {
    const formSchema = z.object({
      email: z.string().describe('Where to send the receipt'),
      agree: z.boolean(),
      plan: z.enum(['free', 'pro']).optional(),
    });
    respond(
      jsonl(
        root,
        element('page', 'Stack', {}, { children: ['email', 'submit'] }),
        element('email', 'Input', {
          label: 'Email',
          name: 'email',
          value: { $bindState: '/form/email' },
        }),
        submitButton
      )
    );
    respond(
      jsonl(
        element('agree', 'Checkbox', {
          label: 'I agree',
          name: 'agree',
          checked: { $bindState: '/form/agree' },
        }),
        { op: 'add', path: '/elements/page/children/-', value: 'agree' }
      )
    );

    const { spec, repairs } = await generateSpec({
      client: mockClient,
      prompt: 'Sign up',
      catalog: testCatalog,
      formSchema,
    });

    const first = mockStreamText.mock.calls[0][0].prompt;
    expect(first).toContain('## Form');
    expect(first).toContain('- email: string - Where to send the receipt');
    expect(first).toContain('- agree: boolean');
    expect(first).toContain('- plan: "free" | "pro" (optional)');

    expect(repairs).toEqual([
      [expect.stringContaining('Missing form field "agree"')],
    ]);
    expect(spec.elements.page.children).toEqual(['email', 'submit', 'agree']);
  });

  it('describes a schema-less form for the generatePage tool', async () => {
    respond(
      jsonl(
        root,
        element('page', 'Stack', {}, { children: ['name', 'submit'] }),
        element('name', 'Input', {
          label: 'Name',
          name: 'name',
          value: { $bindState: '/form/name' },
        }),
        submitButton
      )
    );

    await generateSpec({
      client: mockClient,
      prompt: 'Ask for a name',
      catalog: testCatalog,
      hasForm: true,
    });

    expect(mockStreamText.mock.calls[0][0].prompt).toContain(
      '## Form\nThis page collects user input.'
    );
  });
});
