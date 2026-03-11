# Auth & User Management Cleanup

**Status:** shipped
**Started:** 2026-03-10
**Shipped:** 2026-03-10

## Goal

Simplify the entire auth/users CLI surface: drop UUIDs (name is the ID), flatten `px users keys *` to `px users add-key/remove-key/list-keys`, promote `login`/`logout`/`whoami` to top-level commands, delete the `px auth` namespace entirely.

## Log

### Phase 1: Backend (AuthDO + API routes + whoami)

Rewrote `auth-do.ts` schema from `id TEXT PRIMARY KEY` to `name TEXT PRIMARY KEY`. Added migration path in constructor that detects old schema via `PRAGMA table_info(users)` and migrates data. Merged `getUser()` + `getUserByName()` into single `getUser(name)`. Renamed `UserKey.userId` to `UserKey.userName` everywhere. Updated `users.ts` API routes (`:id` -> `:name`). Updated auth middleware to use `userKey.userName`. Added `GET /auth/whoami` endpoint to `api/index.ts`.

### Phase 2: Spec updates

Updated `User` interface (dropped `id`), `UserKey` interface (`userId` -> `userName`), all spec test functions to use name-based URLs and assertions. Updated `FetchFactory` return type (`userId` -> `userName`). Added `auth.whoami()` spec test. Updated `createUserFetch` in test-auth-helper.ts.

### Phase 3: CLI users commands flattened

Replaced nested `px users keys list/add/remove` with flat `px users list-keys/add-key/remove-key`. All args changed from `id` to `name`. Component props renamed (`userId` -> `userName`). Added `--paste` support to `add-key` (interactive key pasting). Added `convertSSHPubKeyStringToJWK` to ssh-key-utils for paste mode.

### Phase 4: Top-level login/logout/whoami

Deleted entire `px auth` command group. Promoted `login` and `logout` to top-level commands. Created new `whoami` component that calls `GET /auth/whoami` and shows local key info. Deleted `auth-status.tsx`, `auth-list.tsx`, `auth-format-jwk-key.tsx`. Updated all user-facing strings from `px auth login` to `px login`.

### Phase 5: Tests

Updated `test-dev-server.ts` mock data (dropped `id` from `MockUser`, `userId` -> `userName` in `MockUserKey`, users Map keyed by name). Added `GET /auth/whoami` mock endpoint. Rewrote `users.test.ts` with new command syntax and name-based test data. Rewrote `auth.test.ts` — removed tests for deleted commands (status, list, format-jwk-key), updated login/logout to top-level, added whoami tests.

### Clean slate pass: obliterate all userId/user_id references

After review, the user said "assume clean slate — no migrations, no backward compat". Removed the SQLite migration code from auth-do.ts constructor (now just `CREATE TABLE IF NOT EXISTS` with new schema). Then did a full sweep renaming `userId`→`userName`, `user_id`→`user_name`, `CurrentUser.id`→`CurrentUser.name` across ~41 files:

- Core: `CurrentUser { id }` → `CurrentUser { name }` in types.ts, event-stream.ts, scoped-memory.ts comment
- Core tests: bulk sed across all 11 test files for `currentUser: { id:` → `{ name:`
- Cloudflare API: `AuthContext.userId` → `userName`, `scopeUserId()` → `scopeUserName()`, all brains.ts/store.ts local vars
- DOs: `user_id` → `user_name` in SQL for brain-runner-do, monitor-do, schedule-do; `runAsUserId` → `runAsUserName`
- R2: `currentUser.id` → `currentUser.name` in create-r2-store.ts path resolution
- Spec: `userId` → `userName` in store.ts, schedules.ts, scoping.ts response types
- CLI: schedule-list.tsx, store-explorer.tsx, test-dev-server.ts, schedule.test.ts, store.test.ts
- Mem0: adapter.ts `currentUser.id` → `.name`, integration tests
- Template: positronic-guide.md, memory-guide.md, brain.ts comment

Left `MemoryScope.userId` unchanged — that's the external Mem0 API contract.

## Dead ends

None — the plan was well-specified and executed cleanly.

## Solution

Five-phase refactor + clean-slate pass touching 40+ files across all packages:

- **Name is the user ID** — no more UUIDs, clean schema (no migrations)
- **`CurrentUser.name`** — renamed from `.id` throughout the entire codebase
- **`user_name` SQL columns** — all DOs use `user_name` instead of `user_id`
- **`px login` / `px logout` / `px whoami`** — top-level commands replacing `px auth *`
- **`px users add-key/remove-key/list-keys`** — flat instead of `px users keys add/list/remove`
- **`add-key --paste`** — interactive key pasting support
- **`GET /auth/whoami`** — new authenticated endpoint returning `{ name, isRoot }`

All 720 tests pass (540 Jest + 180 vitest). Typecheck clean (only pre-existing RESOURCES_BUCKET errors in test-project).
