import type { BrainEvent } from '@positronic/core';
import type { SqlStorage, R2Bucket } from '@cloudflare/workers-types';

interface EventRow {
  event_id: number;
  event_type: string;
  serialized_event: string | null;
  r2_key: string | null;
  [key: string]: number | string | null;
}

/**
 * Helper class to load events from SQLite, transparently fetching from R2 when needed.
 * Events may be stored inline in SQLite (serialized_event) or overflow to R2 (r2_key).
 */
export class EventLoader {
  constructor(
    private sql: SqlStorage,
    private bucket: R2Bucket
  ) {}

  /**
   * Load all events in order, hydrating from R2 where necessary.
   */
  async loadAllEvents(): Promise<BrainEvent[]> {
    const rows = this.sql
      .exec<EventRow>(
        `SELECT event_id, event_type, serialized_event, r2_key
         FROM brain_events
         ORDER BY event_id ASC`
      )
      .toArray();

    return this.hydrateEvents(rows);
  }

  /**
   * Load a single event by type, optionally ordering to get first/last.
   * Returns null if no event of the given type exists.
   */
  async loadEventByType(
    eventType: string,
    order: 'ASC' | 'DESC' = 'DESC'
  ): Promise<BrainEvent | null> {
    const rows = this.sql
      .exec<EventRow>(
        `SELECT event_id, event_type, serialized_event, r2_key
         FROM brain_events
         WHERE event_type = ?
         ORDER BY event_id ${order}
         LIMIT 1`,
        eventType
      )
      .toArray();

    if (rows.length === 0) {
      return null;
    }

    const events = await this.hydrateEvents(rows);
    return events[0] ?? null;
  }

  /**
   * Hydrate event rows, fetching from R2 in parallel where needed.
   */
  private async hydrateEvents(rows: EventRow[]): Promise<BrainEvent[]> {
    // Identify which rows need R2 fetching
    const r2Fetches: Array<{ index: number; key: string }> = [];
    const events: (BrainEvent | null)[] = new Array(rows.length).fill(null);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.r2_key) {
        r2Fetches.push({ index: i, key: row.r2_key });
      } else if (row.serialized_event) {
        events[i] = JSON.parse(row.serialized_event);
      } else {
        // This shouldn't happen - either r2_key or serialized_event should be set
        console.error(
          `[EventLoader] Event ${row.event_id} has neither r2_key nor serialized_event`
        );
      }
    }

    // Fetch R2 objects in parallel
    if (r2Fetches.length > 0) {
      const fetchPromises = r2Fetches.map(async ({ index, key }) => {
        const r2Object = await this.bucket.get(key);
        if (!r2Object) {
          throw new Error(
            `[EventLoader] R2 object not found for key: ${key}. Cannot reconstruct brain state.`
          );
        }
        const text = await r2Object.text();
        events[index] = JSON.parse(text);
      });

      await Promise.all(fetchPromises);
    }

    // Filter out any nulls (shouldn't happen if data is consistent)
    return events.filter((e): e is BrainEvent => e !== null);
  }
}
