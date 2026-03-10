import { BRAIN_EVENTS } from '@positronic/core';
import type { Fetch, FetchFactory } from './types.js';

/**
 * Helper: read an SSE stream until a terminal event (COMPLETE or ERROR).
 * Cancels the reader once done. Does not throw on errors.
 */
async function readSseUntilTerminal(
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
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
            if (
              event.type === BRAIN_EVENTS.COMPLETE ||
              event.type === BRAIN_EVENTS.ERROR
            ) {
              return;
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

/**
 * Helper: start a brain run as a specific user's fetch, wait for completion,
 * and return the brainRunId.
 */
async function runBrainAndWait(
  fetchFn: Fetch,
  brainIdentifier: string
): Promise<string | null> {
  try {
    const response = await fetchFn(
      new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: brainIdentifier }),
      })
    );

    if (response.status !== 201) {
      console.error(
        `POST /brains/runs returned ${response.status}, expected 201`
      );
      return null;
    }

    const { brainRunId } = (await response.json()) as { brainRunId: string };

    // Watch until completion
    const watchResponse = await fetchFn(
      new Request(`http://example.com/brains/runs/${brainRunId}/watch`)
    );

    if (!watchResponse.ok || !watchResponse.body) {
      console.error(
        `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
      );
      return null;
    }

    await readSseUntilTerminal(watchResponse.body);

    return brainRunId;
  } catch (error) {
    console.error('Failed to run brain and wait:', error);
    return null;
  }
}

export const scoping = {
  /**
   * Test that brain runs are isolated between users.
   *
   * userA creates a run and waits for completion. Then:
   * - userB gets 404 on GET /runs/:runId
   * - root gets 200 on GET /runs/:runId
   * - userA's history has the run
   * - userB's history is empty
   */
  async brainRunIsolation(
    rootFetch: Fetch,
    fetchFactory: FetchFactory,
    brainIdentifier: string
  ): Promise<boolean> {
    try {
      const userA = await fetchFactory('scoping-alice-run');
      const userB = await fetchFactory('scoping-bob-run');

      // userA creates a run and waits for completion
      const brainRunId = await runBrainAndWait(userA.fetch, brainIdentifier);
      if (!brainRunId) {
        console.error('Failed to create and complete brain run as userA');
        return false;
      }

      // userB tries to get the run — should get 404
      const responseB = await userB.fetch(
        new Request(`http://example.com/brains/runs/${brainRunId}`)
      );
      if (responseB.status !== 404) {
        console.error(
          `Expected userB to get 404 for userA's run, got ${responseB.status}`
        );
        return false;
      }

      // root can see the run — should get 200
      const responseRoot = await rootFetch(
        new Request(`http://example.com/brains/runs/${brainRunId}`)
      );
      if (responseRoot.status !== 200) {
        console.error(
          `Expected root to get 200 for userA's run, got ${responseRoot.status}`
        );
        return false;
      }

      const rootRun = (await responseRoot.json()) as { brainRunId: string };
      if (rootRun.brainRunId !== brainRunId) {
        console.error(
          `Root returned wrong brainRunId: expected ${brainRunId}, got ${rootRun.brainRunId}`
        );
        return false;
      }

      // userA's history has the run
      const historyA = await userA.fetch(
        new Request(
          `http://example.com/brains/${encodeURIComponent(brainIdentifier)}/history?limit=50`
        )
      );
      if (historyA.status !== 200) {
        console.error(
          `Expected userA history to return 200, got ${historyA.status}`
        );
        return false;
      }
      const historyDataA = (await historyA.json()) as {
        runs: Array<{ brainRunId: string }>;
      };
      if (historyDataA.runs.length === 0) {
        console.error("userA's history is empty but should have the run");
        return false;
      }

      // userB's history is empty for this brain
      const historyB = await userB.fetch(
        new Request(
          `http://example.com/brains/${encodeURIComponent(brainIdentifier)}/history?limit=50`
        )
      );
      if (historyB.status !== 200) {
        console.error(
          `Expected userB history to return 200, got ${historyB.status}`
        );
        return false;
      }
      const historyDataB = (await historyB.json()) as {
        runs: Array<{ brainRunId: string }>;
      };
      if (historyDataB.runs.length !== 0) {
        console.error(
          `userB's history should be empty but has ${historyDataB.runs.length} runs`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed brain run isolation spec:', error);
      return false;
    }
  },

  /**
   * Test that active runs are isolated between users.
   *
   * userA starts a delayed brain (will remain running).
   * - userA sees it in active-runs
   * - userB does not see it in active-runs
   */
  async activeRunIsolation(
    rootFetch: Fetch,
    fetchFactory: FetchFactory,
    delayedBrainIdentifier: string
  ): Promise<boolean> {
    try {
      const userA = await fetchFactory('scoping-alice-active');
      const userB = await fetchFactory('scoping-bob-active');

      // Start a delayed brain as userA (will be running for a while)
      const response = await userA.fetch(
        new Request('http://example.com/brains/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: delayedBrainIdentifier }),
        })
      );
      if (response.status !== 201) {
        console.error(
          `POST /brains/runs returned ${response.status}, expected 201`
        );
        return false;
      }

      // userB checks active runs — should be empty
      const responseB = await userB.fetch(
        new Request(
          `http://example.com/brains/${encodeURIComponent(delayedBrainIdentifier)}/active-runs`
        )
      );
      if (responseB.status !== 200) {
        console.error(
          `Expected userB active-runs to return 200, got ${responseB.status}`
        );
        return false;
      }
      const activeB = (await responseB.json()) as {
        runs: Array<{ brainRunId: string }>;
      };
      if (activeB.runs.length !== 0) {
        console.error(
          `userB should see 0 active runs but sees ${activeB.runs.length}`
        );
        return false;
      }

      // userA checks active runs — should have the run
      const responseA = await userA.fetch(
        new Request(
          `http://example.com/brains/${encodeURIComponent(delayedBrainIdentifier)}/active-runs`
        )
      );
      if (responseA.status !== 200) {
        console.error(
          `Expected userA active-runs to return 200, got ${responseA.status}`
        );
        return false;
      }
      const activeA = (await responseA.json()) as {
        runs: Array<{ brainRunId: string }>;
      };
      if (activeA.runs.length === 0) {
        console.error(
          'userA should see at least 1 active run but sees 0'
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed active run isolation spec:', error);
      return false;
    }
  },

  /**
   * Test that schedules are isolated between users.
   *
   * userA creates a schedule. Then:
   * - userB can't see it in GET /schedules
   * - userA can see it in GET /schedules
   * - root can see it in GET /schedules
   * - userB can't see runs for it in GET /schedules/runs
   */
  async scheduleIsolation(
    rootFetch: Fetch,
    fetchFactory: FetchFactory,
    brainIdentifier: string
  ): Promise<boolean> {
    try {
      const userA = await fetchFactory('scoping-alice-sched');
      const userB = await fetchFactory('scoping-bob-sched');

      // userA creates a schedule
      const createResponse = await userA.fetch(
        new Request('http://example.com/brains/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: brainIdentifier,
            cronExpression: '0 6 * * *',
          }),
        })
      );
      if (createResponse.status !== 201) {
        console.error(
          `POST /brains/schedules returned ${createResponse.status}, expected 201`
        );
        return false;
      }
      const schedule = (await createResponse.json()) as {
        id: string;
        runAsUserId: string;
      };
      if (schedule.runAsUserId !== userA.userId) {
        console.error(
          `Expected runAsUserId to be '${userA.userId}', got '${schedule.runAsUserId}'`
        );
        return false;
      }

      // userB lists schedules — should not see userA's schedule
      const listResponseB = await userB.fetch(
        new Request('http://example.com/brains/schedules')
      );
      if (listResponseB.status !== 200) {
        console.error(
          `Expected userB schedule list to return 200, got ${listResponseB.status}`
        );
        return false;
      }
      const listB = (await listResponseB.json()) as {
        schedules: Array<{ id: string }>;
      };
      if (listB.schedules.some((s) => s.id === schedule.id)) {
        console.error("userB should not see userA's schedule in list");
        return false;
      }

      // userA lists schedules — should see their own
      const listResponseA = await userA.fetch(
        new Request('http://example.com/brains/schedules')
      );
      if (listResponseA.status !== 200) {
        console.error(
          `Expected userA schedule list to return 200, got ${listResponseA.status}`
        );
        return false;
      }
      const listA = (await listResponseA.json()) as {
        schedules: Array<{ id: string }>;
      };
      if (!listA.schedules.some((s) => s.id === schedule.id)) {
        console.error("userA should see their own schedule in list");
        return false;
      }

      // root lists schedules — should see it
      const listResponseRoot = await rootFetch(
        new Request('http://example.com/brains/schedules')
      );
      if (listResponseRoot.status !== 200) {
        console.error(
          `Expected root schedule list to return 200, got ${listResponseRoot.status}`
        );
        return false;
      }
      const listRoot = (await listResponseRoot.json()) as {
        schedules: Array<{ id: string }>;
      };
      if (!listRoot.schedules.some((s) => s.id === schedule.id)) {
        console.error("root should see userA's schedule in list");
        return false;
      }

      // userB can't see runs for userA's schedule
      const runsResponseB = await userB.fetch(
        new Request(
          `http://example.com/brains/schedules/runs?scheduleId=${schedule.id}`
        )
      );
      if (runsResponseB.status !== 200) {
        console.error(
          `Expected userB schedule runs to return 200, got ${runsResponseB.status}`
        );
        return false;
      }
      const runsB = (await runsResponseB.json()) as {
        runs: Array<{ scheduleId: string }>;
      };
      if (runsB.runs.length !== 0) {
        console.error(
          `userB should see 0 schedule runs but sees ${runsB.runs.length}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed schedule isolation spec:', error);
      return false;
    }
  },

  /**
   * Test that non-root users get 403 on secrets endpoints.
   *
   * A non-root user calling GET/POST/DELETE /secrets gets 403.
   * (Root access to secrets is already tested by secrets.list spec.)
   */
  async secretsRequireRoot(
    rootFetch: Fetch,
    fetchFactory: FetchFactory
  ): Promise<boolean> {
    try {
      const user = await fetchFactory('scoping-user-secrets');

      // GET /secrets — should get 403
      const getResponse = await user.fetch(
        new Request('http://example.com/secrets')
      );
      if (getResponse.status !== 403) {
        console.error(
          `Expected non-root GET /secrets to return 403, got ${getResponse.status}`
        );
        return false;
      }
      const getBody = (await getResponse.json()) as { error: string };
      if (getBody.error !== 'Root access required') {
        console.error(
          `Expected error 'Root access required', got '${getBody.error}'`
        );
        return false;
      }

      // POST /secrets — should get 403
      const postResponse = await user.fetch(
        new Request('http://example.com/secrets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'MY_SECRET', value: 'secret-value' }),
        })
      );
      if (postResponse.status !== 403) {
        console.error(
          `Expected non-root POST /secrets to return 403, got ${postResponse.status}`
        );
        return false;
      }

      // DELETE /secrets/:name — should get 403
      const deleteResponse = await user.fetch(
        new Request('http://example.com/secrets/MY_SECRET', {
          method: 'DELETE',
        })
      );
      if (deleteResponse.status !== 403) {
        console.error(
          `Expected non-root DELETE /secrets to return 403, got ${deleteResponse.status}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed secrets require root spec:', error);
      return false;
    }
  },
};
