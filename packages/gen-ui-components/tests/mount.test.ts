// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import type { Spec } from '@json-render/core';
import { mount, type PageData } from '../src/index.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const formAction =
  'https://example.com/webhooks/system/page-form?identifier=run-1&token=t';

const spec: Spec = {
  root: 'page',
  elements: {
    page: { type: 'Stack', props: {}, children: ['email', 'list', 'submit'] },
    email: {
      type: 'Input',
      props: {
        label: 'Email',
        name: 'email',
        value: { $bindState: '/form/email' },
      },
      children: [],
    },
    list: {
      type: 'Stack',
      props: {},
      repeat: { statePath: '/emails', key: 'id' },
      children: ['pick'],
    },
    pick: {
      type: 'Checkbox',
      props: {
        label: { $item: 'subject' },
        name: 'selected',
        checked: { $bindState: '/form/selected' },
        value: { $item: 'id' },
      },
      children: [],
    },
    submit: {
      type: 'Button',
      props: { label: 'Send' },
      on: { press: [{ action: 'validateForm' }, { action: 'submitForm' }] },
      children: [],
    },
  },
  state: {
    emails: [
      { id: 'a', subject: 'First' },
      { id: 'b', subject: 'Second' },
    ],
  },
};

// React tracks the input's value property; go through the prototype setter so
// the change registers, the way a user typing would.
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setPage(page: PageData) {
  (window as Window & { __POSITRONIC_PAGE__?: PageData }).__POSITRONIC_PAGE__ =
    page;
}

describe('mount', () => {
  let root: HTMLElement;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders the spec, collects the form, and posts it to the form action', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    setPage({ title: 'Inbox', spec, formAction });

    await act(async () => {
      mount(root);
    });

    const email = root.querySelector<HTMLInputElement>('input[name="email"]')!;
    const boxes = root.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    expect(boxes).toHaveLength(2);
    expect(root.textContent).toContain('Second');

    await act(async () => {
      type(email, 'me@example.com');
    });
    await act(async () => {
      boxes[1].click();
    });
    await act(async () => {
      root.querySelector('button')!.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(formAction);
    const body = init!.body as FormData;
    expect(body.get('email')).toBe('me@example.com');
    expect(body.getAll('selected')).toEqual(['b']);
    expect(root.textContent).toContain('Submitted');
  });

  it('shows the failure and keeps the form when the post is rejected', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 403 }));
    setPage({ title: 'Inbox', spec, formAction });

    await act(async () => {
      mount(root);
    });
    await act(async () => {
      root.querySelector('button')!.click();
    });

    expect(root.textContent).toContain('Submission failed (403)');
    expect(root.querySelector('input[name="email"]')).not.toBeNull();
  });
});
