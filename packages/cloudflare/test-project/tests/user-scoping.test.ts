import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import worker from '../src/index';
import { resetMockState } from '../src/runner';
import {
  createAuthenticatedFetchWrapper,
  createUserFetch,
} from './test-auth-helper';
import { scoping } from '@positronic/spec';
import type { Fetch, FetchFactory } from '@positronic/spec';

describe('User-scoped authorization (spec)', () => {
  // Base fetch that calls the worker directly (no auth)
  const baseFetch: Fetch = async (request: Request) => {
    const context = createExecutionContext();
    const response = await worker.fetch(request, env, context);
    await waitOnExecutionContext(context);
    return response;
  };

  // Root-authenticated fetch (uses the test root key)
  const rootFetch = createAuthenticatedFetchWrapper(baseFetch);

  // Factory that creates authenticated fetch functions for named users
  const fetchFactory: FetchFactory = async (userName) => {
    return createUserFetch(baseFetch, rootFetch, userName);
  };

  beforeEach(() => {
    resetMockState();
  });

  it('passes brain run isolation spec', async () => {
    const result = await scoping.brainRunIsolation(
      rootFetch,
      fetchFactory,
      'basic-brain'
    );
    expect(result).toBe(true);
  });

  it('passes active run isolation spec', async () => {
    const result = await scoping.activeRunIsolation(
      rootFetch,
      fetchFactory,
      'delayed-brain'
    );
    expect(result).toBe(true);
  });

  it('passes schedule isolation spec', async () => {
    const result = await scoping.scheduleIsolation(
      rootFetch,
      fetchFactory,
      'basic-brain'
    );
    expect(result).toBe(true);
  });

  it('passes secrets require root spec', async () => {
    const result = await scoping.secretsRequireRoot(rootFetch, fetchFactory);
    expect(result).toBe(true);
  });
});
