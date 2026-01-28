import type { Adapter, BrainEvent } from '@positronic/core';
import type { SqlStorage, R2Bucket } from '@cloudflare/workers-types';

// Size threshold for R2 overflow (1MB)
export const R2_OVERFLOW_THRESHOLD = 1024 * 1024;

// Define the schema with r2_key column for overflow support
const initSQL = `
CREATE TABLE IF NOT EXISTS brain_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    serialized_event TEXT CHECK(serialized_event IS NULL OR json_valid(serialized_event)),
    r2_key TEXT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export class BrainRunSQLiteAdapter implements Adapter {
  private sql: SqlStorage;
  private bucket: R2Bucket;
  private brainRunId: string;
  private schemaInitialized = false;

  constructor(sql: SqlStorage, bucket: R2Bucket, brainRunId: string) {
    this.sql = sql;
    this.bucket = bucket;
    this.brainRunId = brainRunId;
  }

  private initializeSchema() {
    if (!this.schemaInitialized) {
      this.sql.exec(initSQL);
      this.schemaInitialized = true;
    }
  }

  public async dispatch(event: BrainEvent): Promise<void> {
    try {
      this.initializeSchema();

      const serialized = JSON.stringify(event);
      const serializedSize = new TextEncoder().encode(serialized).length;

      if (serializedSize > R2_OVERFLOW_THRESHOLD) {
        // Store in R2, keep reference in SQLite
        // First insert to get event_id, then construct R2 key
        const insertSql = `
          INSERT INTO brain_events (
              event_type,
              serialized_event,
              r2_key
          ) VALUES (?, NULL, 'pending');`;

        this.sql.exec(insertSql, event.type);

        // Get the last inserted event_id
        const result = this.sql
          .exec<{ event_id: number }>(`SELECT last_insert_rowid() as event_id`)
          .toArray();
        const eventId = result[0].event_id;

        // Construct R2 key
        const r2Key = `events/${this.brainRunId}/${eventId}.json`;

        // Store in R2
        await this.bucket.put(r2Key, serialized, {
          customMetadata: {
            eventType: event.type,
            brainRunId: this.brainRunId,
          },
        });

        // Update SQLite with the actual R2 key
        this.sql.exec(
          `UPDATE brain_events SET r2_key = ? WHERE event_id = ?`,
          r2Key,
          eventId
        );
      } else {
        // Store inline in SQLite
        const insertSql = `
          INSERT INTO brain_events (
              event_type,
              serialized_event,
              r2_key
          ) VALUES (?, ?, NULL);`;

        this.sql.exec(insertSql, event.type, serialized);
      }
    } catch (e) {
      console.error(
        '[SQL_ADAPTER] Error handling brain event:',
        e,
        'Event data:',
        JSON.stringify(event)
      );
      throw e;
    }
  }
}
