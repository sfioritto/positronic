import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  fetchMock,
} from 'cloudflare:test';
import worker from '../src/index';
import {
  testStatus,
  resources,
  brains,
  schedules,
  webhooks,
  pages,
  secrets,
  signals,
  auth,
  store,
} from '@positronic/spec';
import { resetMockState } from '../src/runner';
import { createAuthenticatedFetchWrapper } from './test-auth-helper';

describe('Positronic Spec', () => {
  // Helper function to create fetch wrapper for Cloudflare workers
  // Wraps requests with authentication
  const createFetch = () => {
    const baseFetch = async (request: Request) => {
      const context = createExecutionContext();
      const response = await worker.fetch(request, env, context);
      await waitOnExecutionContext(context);
      return response;
    };
    return createAuthenticatedFetchWrapper(baseFetch);
  };

  // Reset mock state before each test
  beforeEach(() => {
    resetMockState();
  });

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
      const result = await brains.runNotFound(
        createFetch(),
        'non-existent-brain'
      );
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
      const result = await brains.getRunNotFound(
        createFetch(),
        'non-existent-run-id'
      );
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

    it('passes agent events spec test (AGENT_START, AGENT_ITERATION, AGENT_TOOL_CALL, AGENT_WEBHOOK)', async () => {
      const result = await brains.watchAgentEvents(
        createFetch(),
        'agent-webhook-brain'
      );
      expect(result).toBe(true);
    });

    it('passes agent webhook resume spec test (full suspend/resume cycle)', async () => {
      const result = await brains.agentWebhookResume(
        createFetch(),
        'agent-webhook-brain',
        'loop-escalation',
        {
          escalationId: 'test-escalation-123',
          approved: true,
          note: 'Approved via spec test',
        }
      );
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/rerun test (destructive rerun)', async () => {
      const fetch = createFetch();

      // Helper to poll until brain reaches a terminal state
      const waitForCompletion = async (runId: string) => {
        for (let i = 0; i < 50; i++) {
          const response = await fetch(
            new Request(`http://example.com/brains/runs/${runId}`)
          );
          const data = (await response.json()) as { status: string };
          if (data.status === 'complete' || data.status === 'error') {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      };

      // First create and run a brain to completion
      const brainRunId = await brains.run(fetch, 'basic-brain');
      expect(brainRunId).toBeTruthy();
      expect(await waitForCompletion(brainRunId!)).toBe(true);

      // Rerun from step 2
      const rerunId = await brains.rerun(fetch, brainRunId!, 2);
      expect(rerunId).toBeTruthy();
      expect(rerunId).toBe(brainRunId);

      // Wait for the rerun to complete so the DO's async work doesn't
      // outlive the test (causes isolated storage errors in vitest)
      expect(await waitForCompletion(brainRunId!)).toBe(true);
    });

    it('passes inner brain COMPLETE does not affect outer brain status test', async () => {
      const result = await brains.innerBrainCompleteDoesNotAffectOuterStatus(
        createFetch(),
        'outer-webhook-after-inner',
        'test-webhook',
        {
          text: 'Resume outer brain',
          user: 'test-user',
          threadId: 'outer-status-test',
        }
      );
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
      const result = await webhooks.notFound(
        createFetch(),
        'non-existent-webhook'
      );
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/system/page-form test', async () => {
      const result = await webhooks.pageForm(
        createFetch(),
        'test-identifier-123',
        {
          name: 'Test User',
          email: 'test@example.com',
        },
        'test-csrf-token-123'
      );
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/system/page-form with array values test', async () => {
      const result = await webhooks.pageForm(
        createFetch(),
        'test-identifier-456',
        {
          selectedItems: ['item1', 'item2', 'item3'],
          name: 'Test User',
        },
        'test-csrf-token-456'
      );
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/system/page-form missing identifier test (400)', async () => {
      const result = await webhooks.pageFormMissingIdentifier(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/system/page-form missing token test (403)', async () => {
      const result = await webhooks.pageFormMissingToken(
        createFetch(),
        'test-identifier-no-token'
      );
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/system/page-form wrong token test (not 200)', async () => {
      const result = await webhooks.pageFormWrongToken(
        createFetch(),
        'test-identifier-wrong-token',
        {
          name: 'Test User',
          email: 'test@example.com',
        },
        'definitely-wrong-token'
      );
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/:slug trigger test (201)', async () => {
      const result = await webhooks.trigger(createFetch(), 'trigger-webhook', {
        data: 'spec-test-payload',
      });
      expect(result).toBe(true);
    });

    it('passes POST /webhooks/:slug ignore test (200)', async () => {
      const result = await webhooks.ignore(createFetch(), 'trigger-webhook', {
        action: 'ignore',
      });
      expect(result).toBe(true);
    });
  });

  describe('Pages', () => {
    it('passes DELETE /pages preserves resources test', async () => {
      const result = await pages.deletePreservesResources(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Signals', () => {
    it('passes POST /brains/runs/:runId/signals PAUSE test', async () => {
      // First create a brain run
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      const result = await signals.pause(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/signals KILL test', async () => {
      // First create a brain run
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      const result = await signals.kill(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/signals USER_MESSAGE test', async () => {
      // First create a brain run (needs an agent brain for this to work properly)
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      const result = await signals.sendMessage(
        createFetch(),
        brainRunId!,
        'Hello from test'
      );
      expect(result).toBe(true);
    });

    // Note: sendMessageNoAgent test removed - USER_MESSAGE signals are now always queued
    // regardless of agent state, and are simply ignored if no agent loop is active.

    it('passes POST /brains/runs/:runId/resume test', async () => {
      // Use delayed-brain which has a 1.5s delay - gives time for PAUSE to be processed
      const brainRunId = await brains.run(createFetch(), 'delayed-brain');
      expect(brainRunId).toBeTruthy();

      // Pause the brain - signal will be queued and processed between steps
      await signals.pause(createFetch(), brainRunId!);

      // Wait for the brain to enter paused state (after first step completes)
      // The delayed-brain has a 1.5s delay in its first step, and PAUSE is checked before second step
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Then resume it
      const result = await signals.resume(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/signals RESUME test', async () => {
      // Use delayed-brain which has a 1.5s delay - gives time for PAUSE to be processed
      const brainRunId = await brains.run(createFetch(), 'delayed-brain');
      expect(brainRunId).toBeTruthy();

      // Pause the brain - signal will be queued and processed between steps
      await signals.pause(createFetch(), brainRunId!);

      // Wait for the brain to enter paused state (after first step completes)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Then resume using the RESUME signal (alternative to /resume endpoint)
      const result = await signals.resumeSignal(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/signals WEBHOOK_RESPONSE test', async () => {
      // Use webhook-brain which waits for a webhook
      const brainRunId = await brains.run(createFetch(), 'webhook-brain');
      expect(brainRunId).toBeTruthy();

      // Wait for the brain to enter waiting state (after first step completes and emits WEBHOOK event)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send webhook response via signal endpoint
      const result = await signals.webhookResponse(createFetch(), brainRunId!, {
        message: 'Hello from signal test',
        value: 42,
      });
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/resume wrong state (409) test', async () => {
      // Create a brain run but don't pause it
      const brainRunId = await brains.run(createFetch(), 'basic-brain');
      expect(brainRunId).toBeTruthy();

      // Try to resume without pausing first - should get 409
      const result = await signals.resumeWrongState(createFetch(), brainRunId!);
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs/:runId/signals not found (404) test', async () => {
      const result = await signals.signalNotFound(
        createFetch(),
        'non-existent-run-id'
      );
      expect(result).toBe(true);
    });
  });

  describe('Auth', () => {
    it('passes GET /auth/setup test', async () => {
      const result = await auth.setup(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Secrets', () => {
    // Mock the Cloudflare API for secrets management
    const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com';
    const SECRETS_PATH =
      '/client/v4/accounts/test-account-id/workers/scripts/test-project/secrets';

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

      const result = await secrets.create(
        createFetch(),
        'TEST_SECRET',
        'test-value'
      );
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
        .intercept({
          path: `${SECRETS_PATH}/SECRET_TO_DELETE`,
          method: 'DELETE',
        })
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

    it('passes POST /secrets rejects ROOT_PUBLIC_KEY test', async () => {
      // No Cloudflare API mocking needed - the endpoint should reject before calling API
      const result = await secrets.createRootKeyRejected(createFetch());
      expect(result).toBe(true);
    });

    it('passes DELETE /secrets/ROOT_PUBLIC_KEY rejected test', async () => {
      // No Cloudflare API mocking needed - the endpoint should reject before calling API
      const result = await secrets.deleteRootKeyRejected(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /secrets excludes ROOT_PUBLIC_KEY test', async () => {
      // Mock Cloudflare API response that includes ROOT_PUBLIC_KEY
      mockSecrets = [
        { name: 'ROOT_PUBLIC_KEY', type: 'secret_text' },
        { name: 'OTHER_SECRET', type: 'secret_text' },
      ];

      fetchMock
        .get(CLOUDFLARE_API_BASE)
        .intercept({ path: SECRETS_PATH, method: 'GET' })
        .reply(200, {
          success: true,
          result: mockSecrets,
          errors: [],
        });

      const result = await secrets.listExcludesRootKey(createFetch(), true);
      expect(result).toBe(true);
    });
  });

  describe('Store', () => {
    // Seed R2 with test store data before each test
    beforeEach(async () => {
      const bucket = (env as { RESOURCES_BUCKET: R2Bucket }).RESOURCES_BUCKET;

      // Shared key
      await bucket.put(
        'store/test-brain/settings.json',
        JSON.stringify({ theme: 'dark', lang: 'en' })
      );

      // Another shared key
      await bucket.put(
        'store/test-brain/config.json',
        JSON.stringify({ maxRetries: 3 })
      );

      // Per-user key (using a fake userName)
      await bucket.put(
        'store/test-brain/user/test-user-123/preferences.json',
        JSON.stringify({ notifications: true })
      );

      // A different brain's store data
      await bucket.put(
        'store/other-brain/data.json',
        JSON.stringify({ count: 42 })
      );
    });

    it('passes GET /store test (list brains with store data)', async () => {
      const result = await store.listBrains(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /store/:brainTitle test (list keys)', async () => {
      const result = await store.listKeys(createFetch(), 'test-brain');
      expect(result).toBe(true);
    });

    it('passes GET /store/:brainTitle/shared/:key test', async () => {
      const result = await store.getSharedValue(
        createFetch(),
        'test-brain',
        'settings'
      );
      expect(result).toBe(true);
    });

    it('passes GET /store/:brainTitle/user/:key test', async () => {
      // Root user won't have a userName for per-user lookup, so we seed one for root
      // Actually, root user has userName=null, so per-user endpoint needs a real user.
      // Let's test this with a user-scoped fetch instead.
      // For now, test that the endpoint returns properly for existing data.
      // Root can't access per-user keys via /user/:key since userName is null.
      // We'll skip this for the root-only fetch and test it in userKeyIsolation.

      // Seed a per-user key for root test (won't match since root has no userName)
      // Instead, just verify the endpoint returns 404 for root (no userName)
      const request = new Request(
        'http://example.com/store/test-brain/user/preferences',
        {
          method: 'GET',
        }
      );
      const response = await createFetch()(request);
      // Root user has null userName, so the key path won't match - expect 404
      expect(response.status).toBe(404);
    });

    it('passes DELETE /store/:brainTitle/shared/:key test', async () => {
      const result = await store.deleteSharedKey(
        createFetch(),
        'test-brain',
        'config'
      );
      expect(result).toBe(true);

      // Verify it's actually deleted
      const bucket = (env as { RESOURCES_BUCKET: R2Bucket }).RESOURCES_BUCKET;
      const object = await bucket.get('store/test-brain/config.json');
      expect(object).toBeNull();
    });

    it('passes DELETE /store/:brainTitle/user/:key test', async () => {
      const result = await store.deleteUserKey(
        createFetch(),
        'test-brain',
        'preferences'
      );
      expect(result).toBe(true);
    });

    it('passes DELETE /store/:brainTitle test (clear brain store)', async () => {
      const result = await store.clearBrainStore(createFetch(), 'test-brain');
      expect(result).toBe(true);
    });

    it('returns correct brain list from GET /store', async () => {
      const request = new Request('http://example.com/store', {
        method: 'GET',
      });
      const response = await createFetch()(request);
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        brains: string[];
        count: number;
      };
      expect(data.brains).toContain('test-brain');
      expect(data.brains).toContain('other-brain');
      expect(data.count).toBe(2);
    });

    it('returns correct keys from GET /store/:brainTitle', async () => {
      const request = new Request('http://example.com/store/test-brain', {
        method: 'GET',
      });
      const response = await createFetch()(request);
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        keys: Array<{ key: string; scope: string; userName?: string }>;
        count: number;
      };

      // Root sees all: shared + per-user
      const keyNames = data.keys.map((k) => k.key);
      expect(keyNames).toContain('settings');
      expect(keyNames).toContain('config');
      expect(keyNames).toContain('preferences');
      expect(data.count).toBe(3);
    });
  });
});
