import type { Fetch } from './types.js';

export const signals = {
  /**
   * Test POST /brains/runs/:runId/signals - Queue PAUSE signal
   * Expects 202 Accepted with signal confirmation
   */
  async pause(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        success: boolean;
        signal: { type: string; queuedAt: number };
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.signal?.type !== 'PAUSE') {
        console.error(
          `Expected signal.type to be 'PAUSE', got '${data.signal?.type}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (PAUSE):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - Queue KILL signal
   * Expects 202 Accepted with signal confirmation
   */
  async kill(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'KILL' }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        success: boolean;
        signal: { type: string; queuedAt: number };
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.signal?.type !== 'KILL') {
        console.error(
          `Expected signal.type to be 'KILL', got '${data.signal?.type}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (KILL):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - Queue USER_MESSAGE signal
   * Expects 202 Accepted with signal confirmation
   */
  async sendMessage(
    fetch: Fetch,
    runId: string,
    content: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'USER_MESSAGE', content }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        success: boolean;
        signal: { type: string; queuedAt: number };
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.signal?.type !== 'USER_MESSAGE') {
        console.error(
          `Expected signal.type to be 'USER_MESSAGE', got '${data.signal?.type}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (USER_MESSAGE):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - USER_MESSAGE without active agent
   * Expects 409 Conflict when no agent step is currently active
   */
  async sendMessageNoAgent(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'USER_MESSAGE', content: 'test message' }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 409) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 409`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error) {
        console.error(
          `Expected error message in response, got ${JSON.stringify(data)}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (USER_MESSAGE no agent):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - Queue RESUME signal
   * Expects 202 Accepted with signal confirmation
   * Note: This is an alternative to POST /brains/runs/:runId/resume
   * The brain must be in PAUSED state for RESUME signal to be valid
   */
  async resumeSignal(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'RESUME' }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        success: boolean;
        signal: { type: string; queuedAt: number };
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.signal?.type !== 'RESUME') {
        console.error(
          `Expected signal.type to be 'RESUME', got '${data.signal?.type}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (RESUME):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - Queue WEBHOOK_RESPONSE signal
   * Expects 202 Accepted with signal confirmation
   * Note: This is an alternative to sending webhooks via POST /webhooks/:slug
   * The brain must be in WAITING state for WEBHOOK_RESPONSE signal to be valid
   */
  async webhookResponse(
    fetch: Fetch,
    runId: string,
    response: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'WEBHOOK_RESPONSE', response }),
        }
      );

      const fetchResponse = await fetch(request);

      if (fetchResponse.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${fetchResponse.status}, expected 202`
        );
        return false;
      }

      const data = (await fetchResponse.json()) as {
        success: boolean;
        signal: { type: string; queuedAt: number };
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.signal?.type !== 'WEBHOOK_RESPONSE') {
        console.error(
          `Expected signal.type to be 'WEBHOOK_RESPONSE', got '${data.signal?.type}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (WEBHOOK_RESPONSE):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/resume - Resume a PAUSED brain
   * Expects 202 Accepted with resumed confirmation
   */
  async resume(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await fetch(request);

      if (response.status !== 202) {
        console.error(
          `POST /brains/runs/${runId}/resume returned ${response.status}, expected 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        success: boolean;
        action: string;
      };

      if (!data.success) {
        console.error(`Expected success: true, got ${JSON.stringify(data)}`);
        return false;
      }

      if (data.action !== 'resumed') {
        console.error(`Expected action to be 'resumed', got '${data.action}'`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/resume:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/resume - Resume a non-PAUSED brain
   * Expects 409 Conflict when brain is not in PAUSED state
   */
  async resumeWrongState(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await fetch(request);

      if (response.status !== 409) {
        console.error(
          `POST /brains/runs/${runId}/resume returned ${response.status}, expected 409`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error) {
        console.error(
          `Expected error message in response, got ${JSON.stringify(data)}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/resume (wrong state):`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/:runId/signals - Signal to non-existent run
   * Expects 404 Not Found
   */
  async signalNotFound(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `POST /brains/runs/${runId}/signals returned ${response.status}, expected 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs/${runId}/signals (not found):`,
        error
      );
      return false;
    }
  },
};
