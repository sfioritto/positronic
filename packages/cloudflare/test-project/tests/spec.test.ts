import { describe, it, expect } from 'vitest';
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../src/index';
import { testStatus } from '@positronic/spec';

describe('Positronic Spec', () => {
  it('passes status endpoint test', async () => {
    const result = await testStatus(async (request) => {
      const context = createExecutionContext();
      const response = await worker.fetch(request, env, context);
      await waitOnExecutionContext(context);
      return response;
    });

    expect(result).toBe(true);
  });
});
