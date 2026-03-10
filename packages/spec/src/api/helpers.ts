import { BRAIN_EVENTS } from '@positronic/core';
import type { Fetch } from './types.js';

/**
 * Read SSE events from a stream, calling shouldStop on each parsed event.
 * Returns all collected events. Cancels the reader when done.
 */
export async function readSseUntil(
  stream: ReadableStream<Uint8Array>,
  shouldStop: (event: any) => boolean
): Promise<any[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: any[] = [];

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
            events.push(event);
            if (shouldStop(event)) {
              return events;
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

  return events;
}

/**
 * Start a brain run and return the brainRunId. Makes the POST request
 * and validates the 201 + brainRunId shape.
 */
export async function startBrainRun(
  fetch: Fetch,
  identifier: string
): Promise<string | null> {
  try {
    const request = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
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
    console.error(`Failed to start brain run:`, error);
    return null;
  }
}
