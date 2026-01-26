import { STATUS, BRAIN_EVENTS } from '@positronic/core';
import type { Fetch } from './types.js';

export const brains = {
  /**
   * Test POST /brains/runs - Create a new brain run
   */
  async run(
    fetch: Fetch,
    identifier: string,
    options?: Record<string, string>
  ): Promise<string | null> {
    try {
      const body: any = { identifier };
      if (options && Object.keys(options).length > 0) {
        body.options = options;
      }

      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = (await response.json()) as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs:`, error);
      return null;
    }
  },

  /**
   * Test POST /brains/runs with options - Create a brain run with runtime options
   */
  async runWithOptions(
    fetch: Fetch,
    identifier: string,
    options: Record<string, string>
  ): Promise<string | null> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier, options }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs with options returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = (await response.json()) as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs with options:`, error);
      return null;
    }
  },

  /**
   * Test POST /brains/runs with non-existent brain - Should return 404
   */
  async runNotFound(
    fetch: Fetch,
    nonExistentBrainTitle: string
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainTitle: nonExistentBrainTitle }),
      });

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `POST /brains/runs with non-existent brain returned ${response.status}, expected 404`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      // Check that the error message mentions the brain title
      if (!data.error.includes(nonExistentBrainTitle)) {
        console.error(
          `Expected error to mention brain title '${nonExistentBrainTitle}', got: ${data.error}`
        );
        return false;
      }

      // Check that the error message follows expected format
      const expectedPattern = new RegExp(
        `Brain '${nonExistentBrainTitle}' not found`
      );
      if (!expectedPattern.test(data.error)) {
        console.error(
          `Expected error message to match pattern "Brain '${nonExistentBrainTitle}' not found", got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs with non-existent brain:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId/watch - Watch a brain run via SSE
   */
  async watch(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${runId}/watch`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/runs/${runId}/watch returned ${response.status}`
        );
        return false;
      }

      // Check that it's an event stream
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        console.error(
          `Expected content-type to be text/event-stream, got ${contentType}`
        );
        return false;
      }

      // Read a bit of the stream to verify it's actually SSE format
      if (response.body) {
        const reader = response.body.getReader();
        try {
          // Read first chunk
          const { value } = await reader.read();
          if (value) {
            const text = new TextDecoder().decode(value);
            // SSE data should contain "data: " lines
            if (!text.includes('data: ')) {
              console.error(
                `Expected SSE format with "data: " prefix, got: ${text.substring(
                  0,
                  100
                )}`
              );
              return false;
            }
          }
        } finally {
          // Always cancel the reader to clean up
          await reader.cancel();
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/runs/${runId}/watch:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier/history - Get history of brain runs
   */
  async history(
    fetch: Fetch,
    identifier: string,
    limit?: number
  ): Promise<boolean> {
    try {
      const url = new URL(
        'http://example.com/brains/' + identifier + '/history'
      );
      if (limit !== undefined) {
        url.searchParams.set('limit', limit.toString());
      }

      const request = new Request(url.toString(), {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/${identifier}/history returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
        runs: Array<{
          brainRunId: string;
          brainTitle: string;
          type: string;
          status: string;
          createdAt: number;
        }>;
      };

      // Validate response structure
      if (!data.runs || !Array.isArray(data.runs)) {
        console.error(`Expected runs to be an array, got ${typeof data.runs}`);
        return false;
      }

      // Validate each run has required fields
      for (const run of data.runs) {
        if (
          !run.brainRunId ||
          !run.brainTitle ||
          !run.type ||
          !run.status ||
          typeof run.createdAt !== 'number'
        ) {
          console.error(`Run missing required fields: ${JSON.stringify(run)}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/${identifier}/history:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/watch - Watch all running brains
   */
  async watchAll(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/watch', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/watch returned ${response.status}`);
        return false;
      }

      // Check that it's an event stream
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        console.error(
          `Expected content-type to be text/event-stream, got ${contentType}`
        );
        return false;
      }

      // Read a bit of the stream to verify it's actually SSE format
      if (response.body) {
        const reader = response.body.getReader();
        try {
          // Read first chunk
          const { value } = await reader.read();
          if (value) {
            const text = new TextDecoder().decode(value);
            // SSE data should contain "data: " lines
            if (!text.includes('data: ')) {
              console.error(
                `Expected SSE format with "data: " prefix, got: ${text.substring(
                  0,
                  100
                )}`
              );
              return false;
            }
          }
        } finally {
          // Always cancel the reader to clean up
          await reader.cancel();
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/watch:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains - List all brains
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        brains: Array<{
          filename: string;
          title: string;
          description: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.brains)) {
        console.error(
          `Expected brains to be an array, got ${typeof data.brains}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each brain has required fields
      for (const brain of data.brains) {
        if (
          !brain.filename ||
          typeof brain.filename !== 'string' ||
          !brain.title ||
          typeof brain.title !== 'string' ||
          !brain.description ||
          typeof brain.description !== 'string'
        ) {
          console.error(
            `Brain missing required fields or has invalid types: ${JSON.stringify(
              brain
            )}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains?q=<query> - Search brains by query string
   * Returns brains matching the query (by title, filename, or description).
   * The matching algorithm is implementation-defined; the spec only verifies
   * the response structure and that results are relevant to the query.
   */
  async search(
    fetch: Fetch,
    query: string
  ): Promise<{
    brains: Array<{
      title: string;
      description: string;
    }>;
    count: number;
  } | null> {
    try {
      const url = new URL('http://example.com/brains');
      url.searchParams.set('q', query);

      const request = new Request(url.toString(), {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains?q=${query} returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        brains: Array<{
          title: string;
          description: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.brains)) {
        console.error(
          `Expected brains to be an array, got ${typeof data.brains}`
        );
        return null;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return null;
      }

      // Validate each brain has required fields
      for (const brain of data.brains) {
        if (
          !brain.title ||
          typeof brain.title !== 'string' ||
          !brain.description ||
          typeof brain.description !== 'string'
        ) {
          console.error(
            `Brain missing required fields or has invalid types: ${JSON.stringify(
              brain
            )}`
          );
          return null;
        }
      }

      // Count should match array length
      if (data.count !== data.brains.length) {
        console.error(
          `Count (${data.count}) does not match brains array length (${data.brains.length})`
        );
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /brains?q=${query}:`, error);
      return null;
    }
  },

  /**
   * Test GET /brains/:identifier - Get brain structure/definition
   * (For future brain exploration/info command)
   */
  async getBrainInfo(fetch: Fetch, identifier: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(identifier)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/${identifier} returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        title: string;
        steps: Array<{
          type: string;
          title: string;
          innerBrain?: {
            title: string;
            steps: any[];
          };
        }>;
      };

      // Validate response structure
      if (!data.title || typeof data.title !== 'string') {
        console.error(`Expected title to be string, got ${typeof data.title}`);
        return false;
      }

      if (!Array.isArray(data.steps)) {
        console.error(
          `Expected steps to be an array, got ${typeof data.steps}`
        );
        return false;
      }

      // Validate each step
      for (const step of data.steps) {
        if (!step.type || !['step', 'brain'].includes(step.type)) {
          console.error(`Invalid step type: ${step.type}`);
          return false;
        }

        if (!step.title || typeof step.title !== 'string') {
          console.error(
            `Step missing title or has invalid type: ${JSON.stringify(step)}`
          );
          return false;
        }

        // If it's a brain step, validate the inner brain recursively
        if (step.type === 'brain' && step.innerBrain) {
          if (
            !step.innerBrain.title ||
            typeof step.innerBrain.title !== 'string'
          ) {
            console.error(
              `Inner brain missing title: ${JSON.stringify(step.innerBrain)}`
            );
            return false;
          }

          if (!Array.isArray(step.innerBrain.steps)) {
            console.error(
              `Inner brain missing steps array: ${JSON.stringify(
                step.innerBrain
              )}`
            );
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/${identifier}:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier/active-runs - Get active/running brain runs
   */
  async activeRuns(fetch: Fetch, identifier: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(
          identifier
        )}/active-runs`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/${identifier}/active-runs returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
        runs: Array<{
          brainRunId: string;
          brainTitle: string;
          type: string;
          status: string;
          createdAt: number;
        }>;
      };

      // Validate response structure
      if (!data.runs || !Array.isArray(data.runs)) {
        console.error(`Expected runs to be an array, got ${typeof data.runs}`);
        return false;
      }

      // Validate each run has required fields
      for (const run of data.runs) {
        if (
          !run.brainRunId ||
          !run.brainTitle ||
          !run.type ||
          !run.status ||
          typeof run.createdAt !== 'number'
        ) {
          console.error(
            `Active run missing required fields: ${JSON.stringify(run)}`
          );
          return false;
        }

        // All active runs should have status 'running'
        if (run.status !== STATUS.RUNNING) {
          console.error(
            `Expected active run status to be '${STATUS.RUNNING}', got ${run.status}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/${identifier}/active-runs:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId - Get detailed information about a specific brain run
   */
  async getRun(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/runs/${runId} returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        brainRunId: string;
        brainTitle: string;
        brainDescription?: string;
        type: string;
        status: string;
        options?: Record<string, any>;
        error?: {
          name: string;
          message: string;
          stack?: string;
        };
        createdAt: number;
        startedAt?: number;
        completedAt?: number;
      };

      // Validate required fields
      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return false;
      }

      if (!data.brainTitle || typeof data.brainTitle !== 'string') {
        console.error(
          `Expected brainTitle to be string, got ${typeof data.brainTitle}`
        );
        return false;
      }

      if (!data.type || typeof data.type !== 'string') {
        console.error(`Expected type to be string, got ${typeof data.type}`);
        return false;
      }

      if (!data.status || typeof data.status !== 'string') {
        console.error(
          `Expected status to be string, got ${typeof data.status}`
        );
        return false;
      }

      if (typeof data.createdAt !== 'number') {
        console.error(
          `Expected createdAt to be number, got ${typeof data.createdAt}`
        );
        return false;
      }

      // If status is error, validate error structure
      if (data.status === STATUS.ERROR && data.error) {
        if (!data.error.name || typeof data.error.name !== 'string') {
          console.error(
            `Expected error.name to be string, got ${typeof data.error.name}`
          );
          return false;
        }
        if (!data.error.message || typeof data.error.message !== 'string') {
          console.error(
            `Expected error.message to be string, got ${typeof data.error.message}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/runs/${runId}:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId with non-existent run - Should return 404
   */
  async getRunNotFound(
    fetch: Fetch,
    nonExistentRunId: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(nonExistentRunId)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `GET /brains/runs/${nonExistentRunId} returned ${response.status}, expected 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/runs/${nonExistentRunId}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier with ambiguous identifier - Should return multiple matches
   * (For future brain exploration/info command)
   */
  async getBrainInfoAmbiguous(
    fetch: Fetch,
    ambiguousIdentifier: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(ambiguousIdentifier)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      // When multiple matches found, expect 300 (Multiple Choices)
      if (response.status !== 300) {
        console.error(
          `GET /brains/${ambiguousIdentifier} with ambiguous identifier returned ${response.status}, expected 300`
        );
        return false;
      }

      const data = (await response.json()) as {
        matchType: 'multiple';
        candidates: Array<{
          title: string;
          filename: string;
          path?: string;
          description?: string;
        }>;
      };

      if (data.matchType !== 'multiple') {
        console.error(
          `Expected matchType to be 'multiple', got ${data.matchType}`
        );
        return false;
      }

      if (!Array.isArray(data.candidates) || data.candidates.length < 2) {
        console.error(
          `Expected candidates to be an array with at least 2 items`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/${ambiguousIdentifier} with ambiguous identifier:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs with ambiguous identifier - Should return multiple matches
   */
  async runAmbiguous(
    fetch: Fetch,
    ambiguousIdentifier: string
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: ambiguousIdentifier }),
      });

      const response = await fetch(request);

      // When multiple matches found, expect 300 (Multiple Choices) or 409 (Conflict)
      if (response.status !== 300 && response.status !== 409) {
        console.error(
          `POST /brains/runs with ambiguous identifier returned ${response.status}, expected 300 or 409`
        );
        return false;
      }

      const data = (await response.json()) as {
        matchType: 'multiple';
        candidates: Array<{
          title: string;
          filename: string;
          path?: string;
          description?: string;
        }>;
      };

      if (data.matchType !== 'multiple') {
        console.error(
          `Expected matchType to be 'multiple', got ${data.matchType}`
        );
        return false;
      }

      if (!Array.isArray(data.candidates) || data.candidates.length < 2) {
        console.error(
          `Expected candidates to be an array with at least 2 items, got ${
            Array.isArray(data.candidates) ? data.candidates.length : 'non-array'
          }`
        );
        return false;
      }

      // Verify each candidate has required fields
      for (const candidate of data.candidates) {
        if (!candidate.title || !candidate.filename) {
          console.error(
            'Each candidate must have title and filename properties'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs with ambiguous identifier:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /brains/runs/rerun - Rerun an existing brain run
   */
  async rerun(
    fetch: Fetch,
    identifier: string,
    runId?: string,
    startsAt?: number,
    stopsAfter?: number
  ): Promise<string | null> {
    try {
      const body: any = { identifier };
      if (runId) body.runId = runId;
      if (startsAt !== undefined) body.startsAt = startsAt;
      if (stopsAfter !== undefined) body.stopsAfter = stopsAfter;

      const request = new Request('http://example.com/brains/runs/rerun', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs/rerun returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = (await response.json()) as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs/rerun:`, error);
      return null;
    }
  },
  /**
   * Test DELETE /brains/runs/:runId - Kill/cancel a running brain run
   */
  async kill(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${runId}`,
        {
          method: 'DELETE',
        }
      );
      const response = await fetch(request);
      if (response.status !== 204) {
        console.error(
          `DELETE /brains/runs/${runId} returned ${response.status}, expected 204`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /brains/runs/${runId}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /brains/runs/:runId for a brain suspended on a webhook.
   * This tests that killing a webhook-suspended brain:
   * 1. Returns 204 (not 409)
   * 2. Updates status to CANCELLED
   * 3. Clears webhook registrations (webhook no longer resumes the brain)
   *
   * Requires a brain with a loop step that will pause on a webhook.
   */
  async killSuspended(
    fetch: Fetch,
    loopBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the loop brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loopBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as {
        brainRunId: string;
      };

      // Step 2: Watch until WEBHOOK event (brain pauses)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundWebhookEvent = false;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundWebhookEvent) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundWebhookEvent = true;
                    break;
                  }
                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    console.error(
                      `Brain completed/errored before WEBHOOK event: ${event.type}`
                    );
                    return false;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundWebhookEvent) {
        console.error('Brain did not emit WEBHOOK event');
        return false;
      }

      // Step 3: Kill the suspended brain
      const killRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'DELETE' }
      );

      const killResponse = await fetch(killRequest);
      if (killResponse.status !== 204) {
        console.error(
          `DELETE /brains/runs/${brainRunId} returned ${killResponse.status}, expected 204`
        );
        return false;
      }

      // Step 4: Verify status is CANCELLED via getRun
      const getRunRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'GET' }
      );

      const getRunResponse = await fetch(getRunRequest);
      if (!getRunResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId} returned ${getRunResponse.status}`
        );
        return false;
      }

      const runData = (await getRunResponse.json()) as { status: string };
      if (runData.status !== STATUS.CANCELLED) {
        console.error(
          `Expected status to be '${STATUS.CANCELLED}', got '${runData.status}'`
        );
        return false;
      }

      // Step 5: Verify webhook no longer resumes the brain
      // Send a webhook - it should return 'no-match' since registrations were cleared
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      // Accept 200/202 - the important thing is it doesn't resume the brain
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      const webhookResult = (await webhookResponse.json()) as {
        received: boolean;
        action?: string;
      };

      // The action should be 'no-match' since webhook registrations were cleared
      if (webhookResult.action === 'resumed') {
        console.error(
          'Webhook resumed the brain after it was killed - webhook registrations were not cleared'
        );
        return false;
      }

      // Verify the brain is still CANCELLED (didn't restart)
      const finalCheckRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'GET' }
      );

      const finalCheckResponse = await fetch(finalCheckRequest);
      if (!finalCheckResponse.ok) {
        console.error(
          `Final GET /brains/runs/${brainRunId} returned ${finalCheckResponse.status}`
        );
        return false;
      }

      const finalRunData = (await finalCheckResponse.json()) as {
        status: string;
      };
      if (finalRunData.status !== STATUS.CANCELLED) {
        console.error(
          `Final status check: expected '${STATUS.CANCELLED}', got '${finalRunData.status}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test kill suspended brain for ${loopBrainIdentifier}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test that agent steps emit proper AGENT_* events in the SSE stream.
   * Requires a brain with an agent step that will pause on a webhook.
   *
   * Expected events before webhook pause:
   * - AGENT_START (with prompt and optional system)
   * - AGENT_ITERATION
   * - AGENT_TOOL_CALL
   * - AGENT_WEBHOOK (before WEBHOOK event)
   * - WEBHOOK
   */
  async watchAgentEvents(
    fetch: Fetch,
    agentBrainIdentifier: string
  ): Promise<boolean> {
    try {
      // Start the agent brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: agentBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as {
        brainRunId: string;
      };

      // Watch the brain run
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      // Read SSE events until we get WEBHOOK or COMPLETE/ERROR
      const events: any[] = [];
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        try {
          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages
            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  events.push(event);

                  // Stop on terminal events
                  if (
                    event.type === BRAIN_EVENTS.WEBHOOK ||
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    done = true;
                    break;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Verify required agent events are present
      const hasAgentStart = events.some(
        (e) => e.type === BRAIN_EVENTS.AGENT_START
      );
      if (!hasAgentStart) {
        console.error('Missing AGENT_START event in SSE stream');
        return false;
      }

      // Verify AGENT_START has prompt field
      const agentStartEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_START
      );
      if (
        !agentStartEvent.prompt ||
        typeof agentStartEvent.prompt !== 'string'
      ) {
        console.error('AGENT_START event missing prompt field');
        return false;
      }

      const hasAgentIteration = events.some(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );
      if (!hasAgentIteration) {
        console.error('Missing AGENT_ITERATION event in SSE stream');
        return false;
      }

      const hasAgentToolCall = events.some(
        (e) => e.type === BRAIN_EVENTS.AGENT_TOOL_CALL
      );
      if (!hasAgentToolCall) {
        console.error('Missing AGENT_TOOL_CALL event in SSE stream');
        return false;
      }

      // If we got a WEBHOOK event, verify AGENT_WEBHOOK came before it
      const webhookIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.WEBHOOK
      );
      if (webhookIndex !== -1) {
        const agentWebhookIndex = events.findIndex(
          (e) => e.type === BRAIN_EVENTS.AGENT_WEBHOOK
        );
        if (agentWebhookIndex === -1) {
          console.error('Missing AGENT_WEBHOOK event before WEBHOOK event');
          return false;
        }
        if (agentWebhookIndex >= webhookIndex) {
          console.error('AGENT_WEBHOOK event must come before WEBHOOK event');
          return false;
        }

        // Verify AGENT_WEBHOOK has required fields
        const agentWebhookEvent = events[agentWebhookIndex];
        if (!agentWebhookEvent.toolCallId || !agentWebhookEvent.toolName) {
          console.error(
            'AGENT_WEBHOOK event missing toolCallId or toolName fields'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test agent events for ${agentBrainIdentifier}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test full agent webhook resumption flow:
   * 1. Start an agent brain that will pause on a webhook
   * 2. Verify it pauses with WEBHOOK event
   * 3. Trigger the webhook with a response
   * 4. Verify the brain resumes and emits WEBHOOK_RESPONSE and AGENT_TOOL_RESULT
   *
   * Requires:
   * - A brain with an agent step that calls a tool returning { waitFor: webhook(...) }
   * - The webhook slug and identifier to trigger
   */
  async agentWebhookResume(
    fetch: Fetch,
    agentBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the agent brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: agentBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as {
        brainRunId: string;
      };

      // Step 2: Watch until WEBHOOK event (brain pauses)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundWebhookEvent = false;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundWebhookEvent) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundWebhookEvent = true;
                    break;
                  }
                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    console.error(
                      `Brain completed/errored before WEBHOOK event: ${event.type}`
                    );
                    return false;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundWebhookEvent) {
        console.error('Brain did not emit WEBHOOK event');
        return false;
      }

      // Step 3: Trigger the webhook
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      const webhookResult = (await webhookResponse.json()) as {
        received: boolean;
        action?: string;
      };

      if (!webhookResult.received) {
        console.error('Webhook was not received');
        return false;
      }

      if (webhookResult.action !== 'resumed') {
        console.error(
          `Expected webhook action 'resumed', got '${webhookResult.action}'`
        );
        return false;
      }

      // Step 4: Watch again for resumed events
      const resumeWatchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const resumeWatchResponse = await fetch(resumeWatchRequest);
      if (!resumeWatchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch (resume) returned ${resumeWatchResponse.status}`
        );
        return false;
      }

      const resumeEvents: any[] = [];
      if (resumeWatchResponse.body) {
        const reader = resumeWatchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        try {
          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  resumeEvents.push(event);

                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    done = true;
                    break;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Verify WEBHOOK_RESPONSE event is present
      const hasWebhookResponse = resumeEvents.some(
        (e) => e.type === BRAIN_EVENTS.WEBHOOK_RESPONSE
      );
      if (!hasWebhookResponse) {
        console.error('Missing WEBHOOK_RESPONSE event after resume');
        return false;
      }

      // Verify AGENT_TOOL_RESULT event is present (with the webhook response as result)
      const hasAgentToolResult = resumeEvents.some(
        (e) => e.type === BRAIN_EVENTS.AGENT_TOOL_RESULT
      );
      if (!hasAgentToolResult) {
        console.error('Missing AGENT_TOOL_RESULT event after resume');
        return false;
      }

      // Verify brain completed successfully
      const completeEvent = resumeEvents.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      if (!completeEvent) {
        console.error('Brain did not complete after resume');
        return false;
      }

      if (completeEvent.status !== STATUS.COMPLETE) {
        console.error(
          `Expected COMPLETE status, got ${completeEvent.status}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test agent webhook resume for ${agentBrainIdentifier}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test that inner brain COMPLETE events don't overwrite outer brain status.
   *
   * This test verifies that when a nested inner brain completes, the outer brain's
   * status in history remains RUNNING (not prematurely set to COMPLETE).
   *
   * Test scenario:
   * 1. Run outer brain that contains inner brain + webhook step after inner brain
   * 2. Watch SSE until outer brain's WEBHOOK event (after inner completes)
   * 3. Query history for the brain
   * 4. Assert status is RUNNING (not COMPLETE from inner brain)
   * 5. Trigger webhook to complete outer brain
   * 6. Assert final status is COMPLETE
   */
  async innerBrainCompleteDoesNotAffectOuterStatus(
    fetch: Fetch,
    outerBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the outer brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: outerBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as {
        brainRunId: string;
      };

      // Step 2: Watch SSE until WEBHOOK event from outer brain (after inner completes)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundOuterWebhook = false;
      let innerCompleteCount = 0;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundOuterWebhook) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));

                  // Track inner brain completes
                  if (event.type === BRAIN_EVENTS.COMPLETE) {
                    innerCompleteCount++;
                    // First complete is inner brain, second would be outer
                  }

                  // Outer brain webhook (happens after inner brain completes)
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundOuterWebhook = true;
                    break;
                  }

                  if (event.type === BRAIN_EVENTS.ERROR) {
                    console.error(
                      `Brain errored: ${JSON.stringify(event.error)}`
                    );
                    return false;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundOuterWebhook) {
        console.error('Did not receive outer brain WEBHOOK event');
        return false;
      }

      if (innerCompleteCount === 0) {
        console.error('Inner brain did not emit COMPLETE event');
        return false;
      }

      // Step 3: Query history - status should be RUNNING, not COMPLETE
      const historyRequest = new Request(
        `http://example.com/brains/${encodeURIComponent(outerBrainIdentifier)}/history?limit=1`,
        { method: 'GET' }
      );

      const historyResponse = await fetch(historyRequest);
      if (!historyResponse.ok) {
        console.error(
          `GET /brains/${outerBrainIdentifier}/history returned ${historyResponse.status}`
        );
        return false;
      }

      const historyData = (await historyResponse.json()) as {
        runs: Array<{ brainRunId: string; status: string }>;
      };

      const ourRun = historyData.runs.find((r) => r.brainRunId === brainRunId);
      if (!ourRun) {
        console.error(`Run ${brainRunId} not found in history`);
        return false;
      }

      // KEY ASSERTION: Status should be RUNNING despite inner brain COMPLETE event
      if (ourRun.status !== STATUS.RUNNING) {
        console.error(
          `Expected status '${STATUS.RUNNING}' but got '${ourRun.status}'. ` +
            `Bug: Inner brain COMPLETE event overwrote outer brain status!`
        );
        return false;
      }

      // Step 4: Trigger webhook to complete outer brain
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      // Step 5: Watch for final completion
      const resumeWatchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const resumeWatchResponse = await fetch(resumeWatchRequest);
      if (!resumeWatchResponse.ok) {
        console.error(`Resume watch returned ${resumeWatchResponse.status}`);
        return false;
      }

      // Wait for the OUTER brain's COMPLETE event specifically (by tracking depth)
      // When resuming, the SSE stream includes historical events, so we need to
      // track START/COMPLETE events to know when the outer brain truly finishes
      let foundFinalComplete = false;
      let depth = 0;
      if (resumeWatchResponse.body) {
        const reader = resumeWatchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundFinalComplete) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));

                  // Track depth to find the outer brain's COMPLETE
                  if (event.type === BRAIN_EVENTS.START) {
                    depth++;
                  } else if (event.type === BRAIN_EVENTS.COMPLETE) {
                    depth--;
                    // When depth reaches 0, the outer brain has completed
                    if (depth <= 0) {
                      foundFinalComplete = true;
                      break;
                    }
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Step 6: Verify final status is COMPLETE
      const finalHistoryResponse = await fetch(historyRequest);
      if (!finalHistoryResponse.ok) {
        console.error('Final history query failed');
        return false;
      }

      const finalHistoryData = (await finalHistoryResponse.json()) as {
        runs: Array<{ brainRunId: string; status: string }>;
      };

      const finalRun = finalHistoryData.runs.find(
        (r) => r.brainRunId === brainRunId
      );
      if (!finalRun || finalRun.status !== STATUS.COMPLETE) {
        console.error(
          `Expected final status '${STATUS.COMPLETE}' but got '${finalRun?.status}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test inner brain complete status for ${outerBrainIdentifier}:`,
        error
      );
      return false;
    }
  },
};
