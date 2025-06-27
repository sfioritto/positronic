import { describe, it, expect } from 'vitest';
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../src/index';
import { testStatus, resources, brains } from '@positronic/spec';

describe('Positronic Spec', () => {
  // Helper function to create fetch wrapper for Cloudflare workers
  const createFetch = () => async (request: Request) => {
    const context = createExecutionContext();
    const response = await worker.fetch(request, env, context);
    await waitOnExecutionContext(context);
    return response;
  };

  it('passes status endpoint test', async () => {
    const result = await testStatus(createFetch());
    expect(result).toBe(true);
  });

  describe('Resources', () => {
    it('passes GET /resources test', async () => {
      const result = await resources.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /resources test', async () => {
      const result = await resources.upload(createFetch());
      expect(result).toBe(true);
    });

    it('passes DELETE /resources/:key test', async () => {
      // First upload a resource to delete
      await resources.upload(createFetch());

      // Then delete it
      const result = await resources.delete(createFetch(), 'test-resource.txt');
      expect(result).toBe(true);
    });

    it('passes DELETE /resources test', async () => {
      const result = await resources.deleteAll(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /resources/presigned-link test', async () => {
      const result = await resources.generatePresignedLink(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Brains', () => {
    it('passes POST /brains/runs test', async () => {
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();
      expect(typeof brainRunId).toBe('string');
    });

    it('passes GET /brains/runs/:runId/watch test', async () => {
      // First create a brain run
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      // Then test watching it
      const result = await brains.watch(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes GET /brains/:brainName/history test', async () => {
      // Just test that the endpoint exists and returns the right structure
      // Don't create a run first to avoid storage issues
      const result = await brains.history(createFetch(), 'basic-brain', 5);
      expect(result).toBe(true);
    });

    it('passes GET /brains/watch test', async () => {
      const result = await brains.watchAll(createFetch());
      expect(result).toBe(true);
    });
  });
});
