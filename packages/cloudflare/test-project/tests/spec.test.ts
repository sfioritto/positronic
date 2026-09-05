import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
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
  bundle,
  users,
} from '@positronic/spec';
import { resetMockState } from '../src/runner';
import {
  createAuthenticatedFetchWrapper,
  createUserFetch,
  TEST_PUBLIC_KEY_JWK,
} from './test-auth-helper';

describe('Positronic Spec', () => {
  // Helper function to create fetch wrapper for Cloudflare workers
  // Wraps requests with authentication
  const baseFetch = async (request: Request) => {
    const context = createExecutionContext();
    const response = await worker.fetch(request, env, context);
    await waitOnExecutionContext(context);
    return response;
  };
  const createFetch = () => createAuthenticatedFetchWrapper(baseFetch);

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

    it('passes GET /brains?q= test (search)', async () => {
      const result = await brains.search(createFetch(), 'brain');
      expect(result).not.toBeNull();
      expect(result!.count).toBeGreaterThan(1);
    });

    it('passes GET /brains/:brainName/active-runs test', async () => {
      const result = await brains.activeRuns(createFetch(), 'basic-brain');
      expect(result).toBe(true);
    });

    it('passes GET /brains/:identifier with ambiguous identifier test (300)', async () => {
      // 'brain' partially matches every fixture path (brains/*.ts)
      const result = await brains.getBrainInfoAmbiguous(createFetch(), 'brain');
      expect(result).toBe(true);
    });

    it('passes POST /brains/runs with ambiguous identifier test', async () => {
      const result = await brains.runAmbiguous(createFetch(), 'brain');
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

      // Out-of-range starts-at must be rejected with a 400, not silently
      // rerun the whole brain from step 1 (basic-brain has 3 steps)
      expect(await brains.rerunOutOfRange(fetch, brainRunId!, 10)).toBe(true);

      // Rerun from step 2
      const rerunId = await brains.rerun(fetch, brainRunId!, 2);
      expect(rerunId).toBeTruthy();
      expect(rerunId).toBe(brainRunId);

      // Wait for the rerun to complete so the DO's async work doesn't
      // outlive the test (causes isolated storage errors in vitest).
      // The rerun happens atomically inside the DO (monitor reset, truncate,
      // resume), so with a fast brain the run may already be 'complete' again
      // by the time we can observe it — completing again is the assertion.
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

    it('passes GET /brains/schedules/timezone test', async () => {
      const timezone = await schedules.getTimezone(createFetch());
      expect(timezone).toBeTruthy();
    });

    it('passes PUT /brains/schedules/timezone test', async () => {
      const fetch = createFetch();
      const result = await schedules.setTimezone(fetch, 'America/Chicago');
      expect(result).toBe(true);

      const timezone = await schedules.getTimezone(fetch);
      expect(timezone).toBe('America/Chicago');
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
    const html = '<html><body><h1>Spec page</h1></body></html>';

    it('passes GET /pages test', async () => {
      const fetch = createFetch();
      await pages.create(fetch, 'spec-list-page', html, 'spec-run-1');

      const result = await pages.list(fetch);
      expect(result).toBe(true);
    });

    it('passes POST /pages test', async () => {
      const slug = await pages.create(
        createFetch(),
        'spec-create-page',
        html,
        'spec-run-1',
        { persist: true, ttl: 3600 }
      );
      expect(slug).toBe('spec-create-page');
    });

    it('passes GET /pages/:slug test', async () => {
      const fetch = createFetch();
      await pages.create(fetch, 'spec-get-page', html, 'spec-run-1');

      const result = await pages.get(fetch, 'spec-get-page');
      expect(result).toBe(html);
    });

    it('passes GET /pages/:slug/meta test', async () => {
      const fetch = createFetch();
      await pages.create(fetch, 'spec-meta-page', html, 'spec-run-1');

      const meta = await pages.getMeta(fetch, 'spec-meta-page');
      expect(meta).not.toBeNull();
      expect(meta!.brainRunId).toBe('spec-run-1');
    });

    it('passes PUT /pages/:slug test', async () => {
      const fetch = createFetch();
      await pages.create(fetch, 'spec-update-page', html, 'spec-run-1');

      const updated = '<html><body><h1>Updated</h1></body></html>';
      const result = await pages.update(fetch, 'spec-update-page', updated);
      expect(result).toBe(true);
      expect(await pages.get(fetch, 'spec-update-page')).toBe(updated);
    });

    it('passes DELETE /pages/:slug test', async () => {
      const fetch = createFetch();
      await pages.create(fetch, 'spec-delete-page', html, 'spec-run-1');

      const result = await pages.delete(fetch, 'spec-delete-page');
      expect(result).toBe(true);
      expect(await pages.notFound(fetch, 'spec-delete-page')).toBe(true);
    });

    it('passes GET /pages/:slug with non-existent page test (404)', async () => {
      const result = await pages.notFound(createFetch(), 'no-such-page');
      expect(result).toBe(true);
    });

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

    it('passes GET /auth/whoami test', async () => {
      const result = await auth.whoami(createFetch());
      expect(result).toEqual({ name: 'root', isRoot: true });
    });
  });

  describe('Bundle', () => {
    it('passes GET /bundle/components.js test when no bundle exists (404)', async () => {
      const result = await bundle.get(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /bundle/components.js test when a bundle exists (200)', async () => {
      const resourcesBucket = (env as { RESOURCES_BUCKET: R2Bucket })
        .RESOURCES_BUCKET;
      await resourcesBucket.put('bundle/components.js', 'mount(root);');

      const result = await bundle.get(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /bundle/components.css test when no bundle exists (404)', async () => {
      const result = await bundle.getCss(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /bundle/components.css test when a bundle exists (200)', async () => {
      const resourcesBucket = (env as { RESOURCES_BUCKET: R2Bucket })
        .RESOURCES_BUCKET;
      await resourcesBucket.put('bundle/components.css', 'body{margin:0}');

      const result = await bundle.getCss(createFetch());
      expect(result).toBe(true);
    });
  });

  describe('Users', () => {
    const fingerprint = 'SHA256:spec-user-key';

    it('passes POST /users test', async () => {
      const name = await users.create(createFetch(), 'spec-user');
      expect(name).toBe('spec-user');
    });

    it('passes GET /users test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');

      const result = await users.list(fetch);
      expect(result).toBe(true);
    });

    it('passes GET /users/:name test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');

      const user = await users.get(fetch, 'spec-user');
      expect(user?.name).toBe('spec-user');
    });

    it('passes GET /users/:name with non-existent user test (404)', async () => {
      const user = await users.get(createFetch(), 'no-such-user');
      expect(user).toBeNull();
    });

    it('passes DELETE /users/:name test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');

      const result = await users.delete(fetch, 'spec-user');
      expect(result).toBe(true);
      expect(await users.get(fetch, 'spec-user')).toBeNull();
    });

    it('passes POST /users/:name/keys test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');

      const result = await users.addKey(
        fetch,
        'spec-user',
        TEST_PUBLIC_KEY_JWK,
        fingerprint,
        'laptop'
      );
      expect(result).toBe(true);
    });

    it('passes GET /users/:name/keys test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');
      await users.addKey(fetch, 'spec-user', TEST_PUBLIC_KEY_JWK, fingerprint);

      const result = await users.listKeys(fetch, 'spec-user');
      expect(result).toBe(true);
    });

    it('passes DELETE /users/:name/keys/:fingerprint test', async () => {
      const fetch = createFetch();
      await users.create(fetch, 'spec-user');
      await users.addKey(fetch, 'spec-user', TEST_PUBLIC_KEY_JWK, fingerprint);

      const result = await users.removeKey(fetch, 'spec-user', fingerprint);
      expect(result).toBe(true);
    });
  });

  describe('Secrets', () => {
    // The secrets routes call the Cloudflare API through the global fetch.
    // Stub it with a small in-memory version of the secrets endpoint.
    const SECRETS_URL =
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/workers/scripts/test-project/secrets';

    let mockSecrets: Array<{ name: string; type: string }> = [];

    const cloudflareApi = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (!url.startsWith(SECRETS_URL)) {
        throw new Error(`Unexpected outbound request: ${method} ${url}`);
      }
      const ok = (result: unknown) =>
        Response.json({ success: true, result, errors: [] });
      if (method === 'GET') {
        return ok(mockSecrets);
      }
      if (method === 'PUT') {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        const secret = { name, type: 'secret_text' };
        mockSecrets.push(secret);
        return ok(secret);
      }
      if (method === 'DELETE') {
        const name = url.slice(SECRETS_URL.length + 1);
        mockSecrets = mockSecrets.filter((s) => s.name !== name);
        return ok(null);
      }
      throw new Error(`Unexpected outbound request: ${method} ${url}`);
    };

    beforeEach(() => {
      mockSecrets = [];
      vi.stubGlobal('fetch', cloudflareApi);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('passes GET /secrets test', async () => {
      const result = await secrets.list(createFetch());
      expect(result).toBe(true);
    });

    it('passes POST /secrets test', async () => {
      const result = await secrets.create(
        createFetch(),
        'TEST_SECRET',
        'test-value'
      );
      expect(result).toBe(true);
    });

    it('passes DELETE /secrets/:name test', async () => {
      await secrets.create(createFetch(), 'SECRET_TO_DELETE', 'temp-value');
      const result = await secrets.delete(createFetch(), 'SECRET_TO_DELETE');
      expect(result).toBe(true);
    });

    it('passes GET /secrets/:name/exists test', async () => {
      mockSecrets = [{ name: 'TEST_SECRET', type: 'secret_text' }];
      const result = await secrets.exists(createFetch(), 'TEST_SECRET');
      expect(result).toBe(true);
    });

    it('passes POST /secrets/bulk test', async () => {
      const result = await secrets.bulk(createFetch(), [
        { name: 'BULK_SECRET_1', value: 'value1' },
        { name: 'BULK_SECRET_2', value: 'value2' },
      ]);
      expect(result).toBe(true);
    });

    it('passes POST /secrets rejects ROOT_PUBLIC_KEY test', async () => {
      // No Cloudflare API call expected; the endpoint rejects first.
      const result = await secrets.createRootKeyRejected(createFetch());
      expect(result).toBe(true);
    });

    it('passes DELETE /secrets/ROOT_PUBLIC_KEY rejected test', async () => {
      // No Cloudflare API call expected; the endpoint rejects first.
      const result = await secrets.deleteRootKeyRejected(createFetch());
      expect(result).toBe(true);
    });

    it('passes GET /secrets excludes ROOT_PUBLIC_KEY test', async () => {
      mockSecrets = [
        { name: 'ROOT_PUBLIC_KEY', type: 'secret_text' },
        { name: 'OTHER_SECRET', type: 'secret_text' },
      ];
      const result = await secrets.listExcludesRootKey(createFetch());
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
      // Per-user keys resolve against the caller's userName, which root does
      // not have, so this contract needs a real non-root user.
      const { fetch: userFetch, userName } = await createUserFetch(
        baseFetch,
        createFetch(),
        'store-user'
      );
      const bucket = (env as { RESOURCES_BUCKET: R2Bucket }).RESOURCES_BUCKET;
      await bucket.put(
        `store/test-brain/user/${userName}/preferences.json`,
        JSON.stringify({ notifications: false })
      );

      const result = await store.getUserValue(
        userFetch,
        'test-brain',
        'preferences'
      );
      expect(result).toBe(true);
    });

    it('returns 404 from GET /store/:brainTitle/user/:key for root (no userName)', async () => {
      const request = new Request(
        'http://example.com/store/test-brain/user/preferences',
        { method: 'GET' }
      );
      const response = await createFetch()(request);
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
