# CLAUDE.md — @positronic/cloudflare

Guidance for working on the Cloudflare backend package.

## Durable Object SQLite Schema Changes REQUIRE Migrations

Every DO (`monitor-do.ts`, `schedule-do.ts`, `auth-do.ts`, `brain-runner-do.ts`, `governor-do.ts`) initializes its schema in the constructor with `CREATE TABLE IF NOT EXISTS`. **That statement is a no-op on any DO that already exists in a deployed project** — existing databases keep their old schema forever unless you migrate them.

So: any change to an existing table (new column, rename, constraint change) MUST ship with a guarded migration in the DO constructor, following the existing pattern:

```typescript
// Migration: add <column> for existing DOs
try {
  this.storage.exec(
    "ALTER TABLE schedules ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'"
  );
} catch (e) {
  // Column already exists
}
```

Rules:

- Adding a `NOT NULL` column via `ALTER TABLE` requires a `DEFAULT` (SQLite rejects it otherwise on non-empty tables). Pick a sensible backfill value.
- Renaming a column is two steps for existing data: add the new column, copy values from the old one. Never just rename it in the `CREATE TABLE` string.
- Migrations are permanent. Once a version has shipped, its migration stays in the constructor — later "cleanup" commits must not remove them (a deployed project may skip versions).

**Why the test suite will not catch a missing migration:** tests run under `@cloudflare/vitest-pool-workers` with fresh storage, so every DO starts empty and `CREATE TABLE IF NOT EXISTS` builds the full new schema. The upgrade path — new code against an old database — is never exercised. When you add a migration, also add a test that creates the _old_ table shape first (raw `CREATE TABLE` with the previous schema in DO storage), then exercises the DO and asserts the migration brought it current.

Real incident this file exists because of: the `userId → userName` "clean slate" rename (420d143) changed `CREATE TABLE` strings and deleted auth-do's migrations, all tests passed, and every already-deployed project then threw `no such column: user_name` on every authenticated request and `no such column: run_as_user_name` in the schedule alarm loop every 60 seconds.
