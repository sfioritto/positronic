import { createBrainExecutionMachine, sendEvent, BRAIN_EVENTS } from '@positronic/core';
import type { BrainEvent } from '@positronic/core';

/**
 * Parse an SSE data field from a raw text chunk.
 * Returns the parsed JSON object, or null if parsing fails.
 */
export function parseSseEvent(text: string): any | null {
  const lines = text.trim().split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.substring(6));
      } catch (e) {
        console.error('[TEST_SSE_PARSE] Failed to parse SSE data:', line.substring(6), e);
        return null;
      }
    }
  }
  return null;
}

/**
 * Read the entire SSE stream and collect events.
 * Uses the brain state machine to know when execution is complete.
 * Throws on ERROR events.
 */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>
): Promise<BrainEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: BrainEvent[] = [];
  const machine = createBrainExecutionMachine();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer.trim().length > 0) {
        const event = parseSseEvent(buffer);
        if (event) {
          events.push(event);
          sendEvent(machine, event);
        }
      }
      break;
    }

    const decodedChunk = decoder.decode(value, { stream: true });
    buffer += decodedChunk;
    let eventEndIndex;
    while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.substring(0, eventEndIndex);
      buffer = buffer.substring(eventEndIndex + 2);
      if (message.startsWith('data:')) {
        const event = parseSseEvent(message);
        if (event) {
          events.push(event);
          sendEvent(machine, event);

          if (machine.context.isComplete) {
            reader.cancel('Brain completed');
            return events;
          }

          if (machine.context.isError) {
            console.error('Received BRAIN_EVENTS.ERROR. Event details:', event);
            reader.cancel('Brain errored');
            throw new Error(`Brain errored. Details: ${JSON.stringify(event)}`);
          }
        }
      }
    }
  }
  return events;
}

/**
 * Read the entire SSE stream including ERROR events without throwing.
 * Waits for one more event after a terminal event (COMPLETE or ERROR)
 * to capture the final STEP_STATUS.
 */
export async function readSseStreamIncludingErrors(
  stream: ReadableStream<Uint8Array>
): Promise<BrainEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: BrainEvent[] = [];
  let sawTerminalEvent = false;
  let eventsAfterTerminal = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer.trim().length > 0) {
        const event = parseSseEvent(buffer);
        if (event) {
          events.push(event);
        }
      }
      break;
    }

    const decodedChunk = decoder.decode(value, { stream: true });
    buffer += decodedChunk;

    let eventEndIndex;
    while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.substring(0, eventEndIndex);
      buffer = buffer.substring(eventEndIndex + 2);
      if (message.startsWith('data:')) {
        const event = parseSseEvent(message);
        if (event) {
          events.push(event);

          if (
            event.type === BRAIN_EVENTS.COMPLETE ||
            event.type === BRAIN_EVENTS.ERROR
          ) {
            sawTerminalEvent = true;
          }

          if (sawTerminalEvent) {
            eventsAfterTerminal++;
            if (
              eventsAfterTerminal > 1 ||
              event.type === BRAIN_EVENTS.STEP_STATUS
            ) {
              reader.cancel('Received final events after terminal');
              return events;
            }
          }
        }
      }
    }
  }
  return events;
}

/**
 * Read SSE events until a specific event type is found.
 * Cancels the reader once the target event is found.
 */
export async function readUntilEvent(
  stream: ReadableStream<Uint8Array>,
  targetType: string
): Promise<{ events: BrainEvent[]; found: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: BrainEvent[] = [];
  let found = false;

  try {
    while (!found) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.substring(0, eventEndIndex);
        buffer = buffer.substring(eventEndIndex + 2);

        if (message.startsWith('data:')) {
          const event = parseSseEvent(message);
          if (event) {
            events.push(event);
            if (event.type === targetType) {
              found = true;
              break;
            }
          }
        }
      }
    }
  } finally {
    await reader.cancel();
  }

  return { events, found };
}
