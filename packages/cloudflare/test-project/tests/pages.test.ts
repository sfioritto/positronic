import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream } from './sse-helpers';
import type {
  BrainEvent,
  BrainCompleteEvent,
  StepCompletedEvent,
} from '@positronic/core';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js';
import type { MonitorDO } from '../../src/monitor-do.js';
import type { ScheduleDO } from '../../src/schedule-do.js';

interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  DB: D1Database;
  RESOURCES_BUCKET: R2Bucket;
}

describe('Pages API Tests', () => {

  // Clean up pages after each test
  afterEach(async () => {
    const testEnv = env as TestEnv;
    const bucket = testEnv.RESOURCES_BUCKET;

    // List and delete all pages
    const listed = await bucket.list({ prefix: 'pages/' });
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
    }
  });

  describe('Pages CRUD API', () => {
    it('POST /pages creates a new page', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'test-page',
          html: '<html><body><h1>Hello</h1></body></html>',
          brainRunId: 'test-brain-run-123',
          persist: false,
        }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(201);
      const body = await response.json<{
        slug: string;
        url: string;
        brainRunId: string;
        persist: boolean;
        createdAt: string;
      }>();

      expect(body.slug).toBe('test-page');
      expect(body.url).toContain('/pages/test-page');
      expect(body.brainRunId).toBe('test-brain-run-123');
      expect(body.persist).toBe(false);
      expect(body.createdAt).toBeDefined();
    });

    it('POST /pages with persist:true creates a persistent page', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'persistent-page',
          html: '<html><body>Persistent</body></html>',
          brainRunId: 'test-brain-run-456',
          persist: true,
          ttl: 3600,
        }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(201);
      const body = await response.json<{
        slug: string;
        persist: boolean;
        ttl?: number;
      }>();

      expect(body.slug).toBe('persistent-page');
      expect(body.persist).toBe(true);
      expect(body.ttl).toBe(3600);
    });

    it('POST /pages validates required fields', async () => {
      const testEnv = env as TestEnv;

      // Note: slug is now optional - if not provided, one is auto-generated

      // Missing html
      const request2 = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'test',
          brainRunId: 'test',
        }),
      });
      const context2 = createExecutionContext();
      const response2 = await worker.fetch(request2, testEnv, context2);
      await waitOnExecutionContext(context2);
      expect(response2.status).toBe(400);
      const error2 = await response2.json<{ error: string }>();
      expect(error2.error).toContain('html');

      // Missing brainRunId
      const request3 = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'test',
          html: '<html></html>',
        }),
      });
      const context3 = createExecutionContext();
      const response3 = await worker.fetch(request3, testEnv, context3);
      await waitOnExecutionContext(context3);
      expect(response3.status).toBe(400);
      const error3 = await response3.json<{ error: string }>();
      expect(error3.error).toContain('brainRunId');
    });

    it('POST /pages validates slug format', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'invalid/slug/with/slashes',
          html: '<html></html>',
          brainRunId: 'test',
        }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(400);
      const body = await response.json<{ error: string }>();
      expect(body.error).toContain('alphanumeric');
    });

    it('GET /pages lists all pages', async () => {
      const testEnv = env as TestEnv;

      // Create a few pages first
      for (let i = 0; i < 3; i++) {
        const createRequest = await createAuthenticatedRequest('http://example.com/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: `list-test-page-${i}`,
            html: `<html><body>Page ${i}</body></html>`,
            brainRunId: `brain-run-${i}`,
          }),
        });
        const createContext = createExecutionContext();
        await worker.fetch(createRequest, testEnv, createContext);
        await waitOnExecutionContext(createContext);
      }

      // List pages
      const listRequest = await createAuthenticatedRequest('http://example.com/pages');
      const listContext = createExecutionContext();
      const listResponse = await worker.fetch(listRequest, testEnv, listContext);
      await waitOnExecutionContext(listContext);

      expect(listResponse.status).toBe(200);
      const body = await listResponse.json<{
        pages: Array<{
          slug: string;
          url: string;
          brainRunId: string;
          persist: boolean;
          createdAt: string;
          size: number;
        }>;
        count: number;
      }>();

      expect(body.pages).toBeInstanceOf(Array);
      expect(body.count).toBeGreaterThanOrEqual(3);

      // Verify page structure
      for (const page of body.pages) {
        expect(page.slug).toBeDefined();
        expect(page.url).toBeDefined();
        expect(page.brainRunId).toBeDefined();
        expect(typeof page.persist).toBe('boolean');
        expect(page.createdAt).toBeDefined();
        expect(typeof page.size).toBe('number');
      }
    });

    it('GET /pages/:slug returns page HTML content', async () => {
      const testEnv = env as TestEnv;
      const htmlContent = '<html><body><h1>Test Content</h1></body></html>';

      // Create a page
      const createRequest = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'get-test-page',
          html: htmlContent,
          brainRunId: 'test-brain-run',
        }),
      });
      const createContext = createExecutionContext();
      await worker.fetch(createRequest, testEnv, createContext);
      await waitOnExecutionContext(createContext);

      // Get the page
      const getRequest = await createAuthenticatedRequest('http://example.com/pages/get-test-page');
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get('Content-Type')).toContain('text/html');
      const body = await getResponse.text();
      expect(body).toBe(htmlContent);
    });

    it('GET /pages/:slug returns 404 for non-existent page', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages/non-existent-page');
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(404);
    });

    it('GET /pages/:slug/meta returns page metadata', async () => {
      const testEnv = env as TestEnv;

      // Create a page
      const createRequest = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'meta-test-page',
          html: '<html><body>Meta test</body></html>',
          brainRunId: 'test-brain-run-meta',
          persist: true,
          ttl: 7200,
        }),
      });
      const createContext = createExecutionContext();
      await worker.fetch(createRequest, testEnv, createContext);
      await waitOnExecutionContext(createContext);

      // Get metadata
      const metaRequest = await createAuthenticatedRequest('http://example.com/pages/meta-test-page/meta');
      const metaContext = createExecutionContext();
      const metaResponse = await worker.fetch(metaRequest, testEnv, metaContext);
      await waitOnExecutionContext(metaContext);

      expect(metaResponse.status).toBe(200);
      const body = await metaResponse.json<{
        slug: string;
        brainRunId: string;
        persist: boolean;
        ttl?: number;
        createdAt: string;
        size: number;
      }>();

      expect(body.slug).toBe('meta-test-page');
      expect(body.brainRunId).toBe('test-brain-run-meta');
      expect(body.persist).toBe(true);
      expect(body.ttl).toBe(7200);
      expect(body.createdAt).toBeDefined();
      expect(typeof body.size).toBe('number');
    });

    it('PUT /pages/:slug updates page content', async () => {
      const testEnv = env as TestEnv;

      // Create a page
      const createRequest = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'update-test-page',
          html: '<html><body>Original</body></html>',
          brainRunId: 'test-brain-run-update',
        }),
      });
      const createContext = createExecutionContext();
      await worker.fetch(createRequest, testEnv, createContext);
      await waitOnExecutionContext(createContext);

      // Update the page
      const updateRequest = await createAuthenticatedRequest('http://example.com/pages/update-test-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: '<html><body>Updated!</body></html>',
        }),
      });
      const updateContext = createExecutionContext();
      const updateResponse = await worker.fetch(updateRequest, testEnv, updateContext);
      await waitOnExecutionContext(updateContext);

      expect(updateResponse.status).toBe(200);
      const updateBody = await updateResponse.json<{
        slug: string;
        url: string;
        updatedAt: string;
      }>();
      expect(updateBody.slug).toBe('update-test-page');
      expect(updateBody.updatedAt).toBeDefined();

      // Verify the content was updated
      const getRequest = await createAuthenticatedRequest('http://example.com/pages/update-test-page');
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      const content = await getResponse.text();
      expect(content).toBe('<html><body>Updated!</body></html>');
    });

    it('PUT /pages/:slug returns 404 for non-existent page', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages/non-existent-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: '<html></html>',
        }),
      });
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(404);
    });

    it('DELETE /pages/:slug deletes a page', async () => {
      const testEnv = env as TestEnv;

      // Create a page
      const createRequest = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'delete-test-page',
          html: '<html><body>To be deleted</body></html>',
          brainRunId: 'test-brain-run-delete',
        }),
      });
      const createContext = createExecutionContext();
      await worker.fetch(createRequest, testEnv, createContext);
      await waitOnExecutionContext(createContext);

      // Delete the page
      const deleteRequest = await createAuthenticatedRequest('http://example.com/pages/delete-test-page', {
        method: 'DELETE',
      });
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(deleteRequest, testEnv, deleteContext);
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const getRequest = await createAuthenticatedRequest('http://example.com/pages/delete-test-page');
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      expect(getResponse.status).toBe(404);
    });
  });

  describe('Optional Slug Behavior', () => {
    it('POST /pages without slug generates a unique slug', async () => {
      const testEnv = env as TestEnv;

      const request = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: '<html><body>Auto-generated slug page</body></html>',
          brainRunId: 'test-brain-run-auto',
        }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(201);
      const body = await response.json<{
        slug: string;
        url: string;
        brainRunId: string;
      }>();

      // Should have generated a slug
      expect(body.slug).toBeDefined();
      expect(body.slug.length).toBeGreaterThan(0);
      expect(body.url).toContain(`/pages/${body.slug}`);
    });

    it('POST /pages without slug generates unique slugs for each call', async () => {
      const testEnv = env as TestEnv;
      const slugs: string[] = [];

      // Create 3 pages without slugs
      for (let i = 0; i < 3; i++) {
        const request = await createAuthenticatedRequest('http://example.com/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: `<html><body>Page ${i}</body></html>`,
            brainRunId: `test-brain-run-${i}`,
          }),
        });

        const context = createExecutionContext();
        const response = await worker.fetch(request, testEnv, context);
        await waitOnExecutionContext(context);

        expect(response.status).toBe(201);
        const body = await response.json<{ slug: string }>();
        slugs.push(body.slug);
      }

      // All slugs should be unique
      const uniqueSlugs = new Set(slugs);
      expect(uniqueSlugs.size).toBe(3);
    });

    it('POST /pages with explicit slug reuses same page (overwrites)', async () => {
      const testEnv = env as TestEnv;
      const slug = 'shared-page';

      // First call creates the page
      const request1 = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          html: '<html><body>First version</body></html>',
          brainRunId: 'brain-run-1',
        }),
      });

      const context1 = createExecutionContext();
      const response1 = await worker.fetch(request1, testEnv, context1);
      await waitOnExecutionContext(context1);

      expect(response1.status).toBe(201);
      const body1 = await response1.json<{ slug: string; createdAt: string }>();
      expect(body1.slug).toBe(slug);
      const firstCreatedAt = body1.createdAt;

      // Second call with same slug overwrites
      const request2 = await createAuthenticatedRequest('http://example.com/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          html: '<html><body>Second version</body></html>',
          brainRunId: 'brain-run-2',
        }),
      });

      const context2 = createExecutionContext();
      const response2 = await worker.fetch(request2, testEnv, context2);
      await waitOnExecutionContext(context2);

      expect(response2.status).toBe(201);
      const body2 = await response2.json<{ slug: string; brainRunId: string }>();
      expect(body2.slug).toBe(slug);
      // brainRunId should be updated to the new one
      expect(body2.brainRunId).toBe('brain-run-2');

      // Verify only one page exists with this slug and has new content
      const getRequest = await createAuthenticatedRequest(`http://example.com/pages/${slug}`);
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      expect(getResponse.status).toBe(200);
      const content = await getResponse.text();
      expect(content).toBe('<html><body>Second version</body></html>');
    });

    it('Brain with no slug creates unique page each run', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'auto-slug-brain';

      // Run the brain twice and collect the page slugs
      const slugs: string[] = [];

      for (let i = 0; i < 2; i++) {
        const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brainTitle: brainName }),
        });
        const createContext = createExecutionContext();
        const createResponse = await worker.fetch(createRequest, testEnv, createContext);
        expect(createResponse.status).toBe(201);
        const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
        await waitOnExecutionContext(createContext);

        // Watch the brain run
        const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
        const watchRequest = await createAuthenticatedRequest(watchUrl);
        const watchContext = createExecutionContext();
        const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

        if (!watchResponse.body) {
          throw new Error('Watch response body is null');
        }

        const allEvents = await readSseStream(watchResponse.body);
        await waitOnExecutionContext(watchContext);

        // Find the step that created the page and extract the slug
        const stepCompleteEvents = allEvents.filter(
          (e): e is StepCompletedEvent => e.type === BRAIN_EVENTS.STEP_COMPLETE
        );
        const createStep = stepCompleteEvents.find(e => e.stepTitle === 'Create page without slug');
        expect(createStep).toBeDefined();
        const patch = createStep!.patch;
        const slugOp = patch.find((op: any) => op.path === '/pageSlug');
        expect(slugOp).toBeDefined();
        slugs.push(slugOp!.value as string);
      }

      // Each run should have created a unique page
      expect(slugs[0]).not.toBe(slugs[1]);
    });

    it('Brain with explicit slug reuses same page across runs', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'fixed-slug-brain';

      // Run the brain twice
      for (let i = 0; i < 2; i++) {
        const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brainTitle: brainName }),
        });
        const createContext = createExecutionContext();
        const createResponse = await worker.fetch(createRequest, testEnv, createContext);
        expect(createResponse.status).toBe(201);
        const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
        await waitOnExecutionContext(createContext);

        // Watch the brain run
        const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
        const watchRequest = await createAuthenticatedRequest(watchUrl);
        const watchContext = createExecutionContext();
        const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

        if (!watchResponse.body) {
          throw new Error('Watch response body is null');
        }

        const allEvents = await readSseStream(watchResponse.body);
        await waitOnExecutionContext(watchContext);

        // Verify completion
        const completeEvent = allEvents.find(
          (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
        );
        expect(completeEvent).toBeDefined();
      }

      // Verify only one page exists with the fixed slug
      const metaRequest = await createAuthenticatedRequest('http://example.com/pages/fixed-slug-page/meta');
      const metaContext = createExecutionContext();
      const metaResponse = await worker.fetch(metaRequest, testEnv, metaContext);
      await waitOnExecutionContext(metaContext);

      expect(metaResponse.status).toBe(200);
      const meta = await metaResponse.json<{ slug: string }>();
      expect(meta.slug).toBe('fixed-slug-page');

      // Verify content is from the second run (overwrote first)
      const getRequest = await createAuthenticatedRequest('http://example.com/pages/fixed-slug-page');
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      const content = await getResponse.text();
      expect(content).toContain('Run 2');
    });
  });

  describe('Pages Service in Brain', () => {
    it('Brain can create and manage pages via pages service', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'pages-brain';

      // Start the brain
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      expect(createResponse.status).toBe(201);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
      await waitOnExecutionContext(createContext);

      // Watch the brain run
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = await createAuthenticatedRequest(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

      expect(watchResponse.status).toBe(200);
      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      const allEvents = await readSseStream(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // Check for completion
      const completeEvent = allEvents.find(
        (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);

      // Check step completions
      const stepCompleteEvents = allEvents.filter(
        (e): e is StepCompletedEvent => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );

      // Verify Create page step
      const createPageStep = stepCompleteEvents.find(e => e.stepTitle === 'Create page');
      expect(createPageStep).toBeDefined();
      expect(createPageStep?.patch).toBeDefined();
      const createPatch = createPageStep!.patch;
      const pageCreatedOp = createPatch.find((op: any) => op.path === '/pageCreated');
      expect(pageCreatedOp?.value).toBe(true);

      // Verify Check page exists step
      const checkExistsStep = stepCompleteEvents.find(e => e.stepTitle === 'Check page exists');
      expect(checkExistsStep).toBeDefined();
      const existsPatch = checkExistsStep!.patch;
      const pageExistsOp = existsPatch.find((op: any) => op.path === '/pageExists');
      expect(pageExistsOp?.value).toBe(true);

      // Verify Get page content step
      const getContentStep = stepCompleteEvents.find(e => e.stepTitle === 'Get page content');
      expect(getContentStep).toBeDefined();
      const contentPatch = getContentStep!.patch;
      const pageContentOp = contentPatch.find((op: any) => op.path === '/pageContent');
      expect(pageContentOp?.value).toContain('Hello World');

      // Verify Update page step
      const updateStep = stepCompleteEvents.find(e => e.stepTitle === 'Update page');
      expect(updateStep).toBeDefined();
      const updatePatch = updateStep!.patch;
      const pageUpdatedOp = updatePatch.find((op: any) => op.path === '/pageUpdated');
      expect(pageUpdatedOp?.value).toBe(true);

      // Verify the page exists in R2 with updated content
      const getRequest = await createAuthenticatedRequest('http://example.com/pages/test-page');
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      expect(getResponse.status).toBe(200);
      const content = await getResponse.text();
      expect(content).toContain('Updated!');
    });

    it('Brain can create persistent pages', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'persistent-page-brain';

      // Start the brain
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      expect(createResponse.status).toBe(201);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
      await waitOnExecutionContext(createContext);

      // Watch the brain run
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = await createAuthenticatedRequest(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      const allEvents = await readSseStream(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // Check for completion
      const completeEvent = allEvents.find(
        (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);

      // Verify the step result includes persist: true
      const stepCompleteEvents = allEvents.filter(
        (e): e is StepCompletedEvent => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      const createStep = stepCompleteEvents.find(e => e.stepTitle === 'Create persistent page');
      expect(createStep).toBeDefined();
      const patch = createStep!.patch;
      const persistOp = patch.find((op: any) => op.path === '/persist');
      expect(persistOp?.value).toBe(true);

      // Verify the page exists and is marked as persistent
      const metaRequest = await createAuthenticatedRequest('http://example.com/pages/persistent-test/meta');
      const metaContext = createExecutionContext();
      const metaResponse = await worker.fetch(metaRequest, testEnv, metaContext);
      await waitOnExecutionContext(metaContext);

      expect(metaResponse.status).toBe(200);
      const meta = await metaResponse.json<{ persist: boolean }>();
      expect(meta.persist).toBe(true);
    });
  });
});
