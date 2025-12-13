import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  fetchMock,
} from 'cloudflare:test';
import worker from '../src/index';
import { testStatus, resources, brains, schedules, webhooks, pages, secrets } from '@positronic/spec';

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

    it('passes DELETE /resources preserves pages test', async () => {
      const result = await resources.deleteAllPreservesPages(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Brains', () => {
    it('passes GET /brains test', async () => {
      const result = await brains.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /brains/:brainName test (brain info)', async () => {
      const result = await brains.getBrainInfo(createFetch(), 'basic-brain');
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs test', async () => {
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();
      expect(typeof brainRunId).toBe('string');
    });

    it('passes POST /brains/runs with options test', async () => {
      const brainRunId = await brains.runWithOptions(
        createFetch(), 
        'options-brain',
        { environment: 'test', debug: 'true' }
      );
      expect(brainRunId).toBeTruthy();
      expect(typeof brainRunId).toBe('string');
    });

    it('passes POST /brains/runs with non-existent brain test (404)', async () => {
      const result = await brains.runNotFound(createFetch(), 'non-existent-brain');
      expect(result).toBe(true);
    });

    it('passes GET /brains/runs/:runId/watch test', async () => {
      // First create a brain run
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      // Then test watching it
      const result = await brains.watch(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes GET /brains/runs/:runId test (get run details)', async () => {
      // First create a brain run
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      // Then test getting run details
      const result = await brains.getRun(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes GET /brains/runs/:runId test with non-existent run (404)', async () => {
      const result = await brains.getRunNotFound(createFetch(), 'non-existent-run-id');
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

  describe('Schedules', () => {
    it('passes POST /brains/schedules test', async () => {
      const scheduleId = await schedules.create(
        createFetch(),
        'basic-brain',
        '0 3 * * *'
      );
      expect(scheduleId).toBeTruthy();
      expect(typeof scheduleId).toBe('string');
    });

    it('passes GET /brains/schedules test', async () => {
      const result = await schedules.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes DELETE /brains/schedules/:scheduleId test', async () => {
      // First create a schedule
      const scheduleId = await schedules.create(
        createFetch(),
        'basic-brain',
        '0 3 * * *'
      );
      expect(scheduleId).toBeTruthy();

      // Then delete it
      const result = await schedules.delete(createFetch(), scheduleId!);
      expect(result).toBe(true);
    });

    it('passes GET /brains/schedules/runs test', async () => {
      const result = await schedules.runs(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Webhooks', () => {
    it('passes GET /webhooks test', async () => {
      const result = await webhooks.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/:slug test', async () => {
      const result = await webhooks.receive(createFetch(), 'test-webhook', {
        text: 'Hello from test',
        user: 'test-user',
        threadId: 'test-thread-123',
      });
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/:slug with non-existent webhook test (404)', async () => {
      const result = await webhooks.notFound(createFetch(), 'non-existent-webhook');
      expect(result).toBe(true);
    });
  });

  describe('Pages', () => {
    it('passes DELETE /pages preserves resources test', async () => {
      const result = await pages.deletePreservesResources(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Secrets', () => {
    // Mock the Cloudflare API for secrets management
    const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com';
    const SECRETS_PATH = '/client/v4/accounts/test-account-id/workers/scripts/test-project/secrets';

    // Track mock secrets for realistic responses
    let mockSecrets: Array<{ name: string; type: string }> = [];

    beforeAll(() => {
      fetchMock.activate();
      fetchMock.disableNetConnect();
    });

    afterEach(() => {
      fetchMock.assertNoPendingInterceptors();
      mockSecrets = [];
    });

    it('passes GET /secrets test', async () => {
      // Mock Cloudflare API list secrets response
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'GET' })
        .reply(200, {
          success: true,
          result: mockSecrets,
          errors: [],
        });

      const result = await secrets.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /secrets test', async () => {
      // Mock Cloudflare API create secret response
      // Note: The API sends the secret name in the body, not the URL
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'PUT' })
        .reply(200, {
          success: true,
          result: { name: 'TEST_SECRET', type: 'secret_text' },
          errors: [],
        });

      const result = await secrets.create(createFetch(), 'TEST_SECRET', 'test-value');
      expect(result).toBe(true);
    });

    it('passes DELETE /secrets/:name test', async () => {
      // Mock create first (secret name in body, not URL)
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'PUT' })
        .reply(200, {
          success: true,
          result: { name: 'SECRET_TO_DELETE', type: 'secret_text' },
          errors: [],
        });

      // First create a secret to delete
      await secrets.create(createFetch(), 'SECRET_TO_DELETE', 'temp-value');

      // Mock delete (delete still uses name in URL)
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: `${SECRETS_PATH}/SECRET_TO_DELETE`, method: 'DELETE' })
        .reply(200, {
          success: true,
          result: null,
          errors: [],
        });

      // Then delete it
      const result = await secrets.delete(createFetch(), 'SECRET_TO_DELETE');
      expect(result).toBe(true);
    });

    it('passes GET /secrets/:name/exists test', async () => {
      // Add a secret to the mock list
      mockSecrets = [{ name: 'TEST_SECRET', type: 'secret_text' }];

      // Mock list to check existence
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'GET' })
        .reply(200, {
          success: true,
          result: mockSecrets,
          errors: [],
        });

      const result = await secrets.exists(createFetch(), 'TEST_SECRET');
      expect(result).toBe(true);
    });

    it('passes POST /secrets/bulk test', async () => {
      // Mock list to check existing secrets
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'GET' })
        .reply(200, {
          success: true,
          result: [],
          errors: [],
        });

      // Mock create for each secret (secret name in body, not URL)
      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'PUT' })
        .reply(200, {
          success: true,
          result: { name: 'BULK_SECRET_1', type: 'secret_text' },
          errors: [],
        });

      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'PUT' })
        .reply(200, {
          success: true,
          result: { name: 'BULK_SECRET_2', type: 'secret_text' },
          errors: [],
        });

      const result = await secrets.bulk(createFetch(), [
        { name: 'BULK_SECRET_1', value: 'value1' },
        { name: 'BULK_SECRET_2', value: 'value2' },
      ]);
      expect(result).toBe(true);
    });
  });
});
