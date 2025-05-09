import type { Adapter, WorkflowEvent } from '@positronic/core';
import type { SqlStorage } from '@cloudflare/workers-types';

// Define the new schema with a single events table
const initSQL = `
CREATE TABLE IF NOT EXISTS workflow_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    serialized_event TEXT NOT NULL CHECK(json_valid(serialized_event)),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export class WorkflowRunSQLiteAdapter implements Adapter {
  private sql: SqlStorage;
  private schemaInitialized = false; // Track schema initialization

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  private initializeSchema() {
    if (!this.schemaInitialized) {
      this.sql.exec(initSQL);
      this.schemaInitialized = true;
    }
  }

  public dispatch(event: WorkflowEvent) {
    try {
      this.initializeSchema();

      const insertSql = `
                INSERT INTO workflow_events (
                    event_type,
                    serialized_event
                ) VALUES (?, ?);`;

      this.sql.exec(insertSql, event.type, JSON.stringify(event));
    } catch (e) {
      console.error(
        '[SQL_ADAPTER] Error handling workflow event:',
        e,
        'Event data:',
        JSON.stringify(event)
      );
      throw e;
    }
  }
}
