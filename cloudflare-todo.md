# Positronic Cloudflare Architecture: Flow & To-Do

**High-Level Goal:** Provide a seamless developer experience for defining, running, and deploying stateful workflows and agents on Cloudflare, abstracted via the `@positronic/cli`. A secondary goal is to allow simple, local execution of single workflow/agent files directly via the CLI for rapid testing.

This document outlines the intended end-to-end flow for running Positronic workflows on Cloudflare. It also includes a checklist for implementation.

## Deployment Model & Build Strategy (CLI-Driven)

- The `@positronic/cloudflare` package provides the core runtime components (Hono API entry point, `WorkflowDO`, adapters).
- User projects are generated via the `@positronic/cli` and include `@positronic/cloudflare` as a dependency.
- **CLI Orchestration:** The `positronic` CLI command (e.g., `positronic serve`, `positronic deploy`) is the primary interface for users. It orchestrates the build and deployment process.
- **Hidden Build Directory:** The CLI will compile/bundle the user's project (including their workflows/agents and the `@positronic/cloudflare` library) into a hidden directory (e.g., `.positronic/build/`). This keeps the user's project root clean and backend-agnostic.
- **Targeted `wrangler` Execution:** The CLI invokes `wrangler dev` or `wrangler deploy` commands specifically targeting the generated `.positronic/build/` directory.
- **User Configuration (`positronic.config.js`):** A `positronic.config.js` file in the user's project root will be the primary way to configure settings like dev server port, basic bindings, and cron schedules. The CLI reads this and translates it into the necessary backend configuration during the build.
- **`wrangler.toml` Override:** To allow for advanced Cloudflare customization without ejecting, if the user creates a `wrangler.toml` (or `wrangler.jsonc`) file in their project root, the CLI will **copy and use this file directly** within the `.positronic/build/` directory, _instead_ of generating one from `positronic.config.js`. This provides a clear override mechanism for users who need fine-grained control over the Wrangler configuration.
- **Eject Command:** A `positronic eject` command will be provided. This command performs a final build into the hidden directory and then copies its entire contents (generated `wrangler.toml`, bundled code including the DO, `index.ts`, etc.) into the user's project root, adding standard `npm` scripts. This converts the project into a standard, standalone Wrangler project, allowing users full control but removing the CLI abstraction benefits.
- **Local Development (`positronic serve`):**
  - This command will trigger the build process into the hidden directory.
  - It will then run `wrangler dev` targeting the hidden directory.
  - **File Watching & Rebuild:** To handle changes in the user's source code (`src/`), the CLI will leverage Wrangler's build configuration. The generated `wrangler.toml` will include a `[build]` section with `command = "positronic internal-build"` and `watch_dir = "../../src"` (adjust path as needed). This delegates watching to Wrangler, which will call the Positronic CLI's internal build step upon detecting changes, ensuring a smoother reload experience compared to managing separate watchers.

**Deployment Model Clarification:**

- The `@positronic/cloudflare` package (this code) will be published as an npm library.
- User projects are generated via the CLI and include `@positronic/cloudflare` as a dependency.
- The **`positronic` CLI** manages the deployment, building into a hidden directory and running `wrangler deploy` against that directory. Direct `wrangler` usage by the user is only intended after `positronic eject`.
- The **CLI's build process** is responsible for bundling the user's specific workflows/agents alongside the `@positronic/cloudflare` library code into the hidden build directory. This includes generating the necessary manifest (see section 6).

## Updated End-to-End Flow Simulation

1.  **User (CLI):** Initiates a run: `positronic run my-workflow --verbose`.
2.  **CLI (`positronic.ts`):**
    - Parses the command.
    - Determines the target Hono API endpoint (local dev via `positronic serve` or remote prod).
    - Makes an authenticated POST request to Hono (e.g., `/runs`) with workflow name (`my-workflow`).
3.  **Hono API Worker (Running from `.positronic/build/`):**
    - Authenticates/Authorizes the request.
    - Validates the workflow name (`my-workflow`) against the bundled manifest (see Section 6).
    - Generates a unique `workflowRunId`.
    - Constructs the Durable Object ID (from `workflowRunId`).
    - Gets the DO stub: `env.DO_NAMESPACE.get(doId)`.
    - Sends an internal `fetch` request (`POST /init`) to the DO, passing `workflowRunId`, workflow name, the bundled registry object, and necessary configurations/secrets. This activates the DO.
    - Constructs and returns the `workflowRunId` and the specific `workflowRunURL` for the DO to the CLI.
4.  **CLI (`positronic.ts`):**
    - Prints the `workflowRunId` and `workflowRunURL` to the user.
5.  **Durable Object (Running from `.positronic/build/`, Activation & Init):**
    - DO instance activates. `constructor` runs.
    - `constructor` loads WebSocket sessions from DO storage: `this.state.storage.get('sessions')`.
    - The `/init` handler receives the fetch request from Hono.
    - Stores `workflowRunId` and the passed-in `workflowRegistry`.
    - **Local SQLite Read (State Load):** Queries local SQLite DB for any existing completed steps for this `workflowRunId` (likely none on initial init, but important for restarts/wake-ups).
    - Reconstructs `this.currentState` by applying patches from completed steps found in local SQLite DB.
    - Sets up `WorkflowRunner`, loads the specific `Workflow` definition (via lookup in the received `workflowRegistry`), configures `PromptClient`, `SQLiteAdapter`, `WebSocketAdapter`, and services.
    - **Starts Run:** Calls `workflowRunner.run({ initialState: this.currentState, ..., client })`.
    - **Sets Timer:** Calls `this.resetHibernationTimer()` to set the initial 5-minute inactivity alarm.
6.  **Durable Object (Active Execution Loop):**
    - The runner yields `WorkflowEvent`s.
    - For each event:
      - `SQLiteAdapter` persists the event/patch/status update to local SQLite DB.
      - `WebSocketAdapter` broadcasts the event to all connected clients listed in `this.sessions`.
      - SSE connections are also updated with the event
      - The workflow logic updates the **in-memory `this.currentState`**.
      - Calls `this.resetHibernationTimer()` to postpone hibernation due to activity.
7.  **User (Web Client):** Connects via the `workflowRunURL`.
8.  **Web Client:** Establishes an authenticated WebSocket connection.
9.  **Durable Object (WebSocket Connection):**
    - `fetch` handler receives the upgrade request.
    - Authenticates the connection.
    - Accepts the WebSocket: `this.state.acceptWebSocket(serverSocket)`.
    - Adds the `serverSocket` to the `this.sessions` array (in-memory).
    - _Optional:_ Queries local SQLite DB for current step status/history and sends it to the newly connected client.
    - Calls `this.resetHibernationTimer()`.
10. **Web Client:** Receives real-time `WorkflowEvent`s, updates UI.
11. **Workflow (Requires Input):** A step needs human interaction.
12. **Durable Object (Input Request):**
    - `WebSocketAdapter` sends `USER_INPUT_REQUIRED` message to clients.
    - The workflow runner pauses, awaiting input (e.g., waiting on a promise).
    - Calls `this.resetHibernationTimer()`.
    - _(No immediate hibernation)_
13. **Web Client:** Displays prompt to user.
14. **User (Provides Input):** Submits response via Web UI.
15. **Web Client:** Sends `USER_INPUT_RESPONSE` message via WebSocket.
16. **Durable Object (Receives Input):**
    - `webSocketMessage` handler receives the input.
    - Calls `this.resetHibernationTimer()`.
    - Resolves the promise the workflow runner was waiting on, providing the input.
    - Workflow resumes, generating new events, updating in-memory `this.currentState`, persisting to local SQLite DB via adapter, broadcasting via WebSockets and SSE.
17. **Inactivity Timeout:** 5 minutes pass with no relevant activity (no new steps, no incoming messages).
18. **Durable Object (`alarm()`):**
    - The inactivity alarm triggers the `alarm()` handler.
    - **Persists Sessions:** Saves the current `this.sessions` list: `this.state.storage.put('sessions', this.sessions)`.
    - _(Workflow state is already persisted in D1)_.
    - **Clears In-Memory State:** Sets `this.currentState = null` (and potentially discards runner instance) to free memory.
    - DO becomes idle. If Hibernatable WebSockets are used correctly (via `acceptWebSocket` and potentially `waitUntil`), connections stay open but compute billing stops. Cloudflare eventually hibernates the object.
19. **User (Provides Input After Hibernation):** User sends input via Web Client.
20. **Web Client:** Sends `USER_INPUT_RESPONSE` via WebSocket.
21. **Durable Object (Wake & Resume):**
    - Incoming WebSocket message wakes the DO instance.
    - `constructor` runs, loads sessions from storage: `this.state.storage.get('sessions')`.
    - `webSocketMessage` handler is invoked.
    - **Calls `ensureWorkflowLoaded()`:**
      - Detects `this.currentState` is `null`.
      - **Local SQLite Read (State Load):** Queries local SQLite DB for `initialState` and all `COMPLETE` `SerializedStep`s for the `workflowRunId`.
      - Reconstructs `this.currentState` by applying patches from local SQLite DB steps.
      - Re-initializes the `WorkflowRunner` to resume from the step _after_ the last completed one found in local SQLite DB.
    - Calls `this.resetHibernationTimer()`.
    - Processes the user input, feeding it to the resumed workflow runner.
    - Execution continues as in step 16.
22. **Workflow End:**
    - Runner yields `COMPLETE` or `ERROR`.
    - `SQLiteAdapter` writes final status/error to local SQLite DB.
    - `WebSocketAdapter` broadcasts final event.
    - `this.resetHibernationTimer()` might be called one last time.
    - Eventually, the inactivity alarm fires, sessions are saved, and the DO hibernates.

## Implementation To-Do List

### 0. CLI (`@positronic/cli`) & Build Process

- **[ ] Core CLI Structure:** Setup basic command handling (`serve`, `deploy`, `run`, `eject`).
- **[ ] Hidden Build Logic:**
  - **[ ]** Implement scanning of user project (`src/`) for workflows/agents based on convention.
  - **[ ]** Implement generation of the main worker entry point (`index.ts`) in the build directory. This entry point will include:
    - Static `import` statements for all discovered user workflows/agents (to ensure bundling).
    - Generation of a `manifest` object (e.g., `workflowRegistry`, `agentRegistry`) mapping names to the imported modules.
    - A call to `setRuntimeManifest(manifest)` (imported from `@positronic/cloudflare`) during worker startup to populate the shared manifest accessible by the DO.
    - Import and export of the Hono app setup.
  - **[ ]** Implement bundling process (e.g., using esbuild API) targeting the hidden directory, ensuring user code, generated entry point, and `@positronic/cloudflare` are included.
- **[ ] Configuration Handling:**
  - **[ ]** Implement reading `positronic.config.js`.
  - **[ ]** Implement logic to check for `wrangler.toml`/`wrangler.jsonc` in user root.
  - **[ ]** Implement generation of `wrangler.toml` in build dir based on `positronic.config.js` _or_ copying the user's override file.
  - **[ ]** Define schema for `positronic.config.js` (dev port, bindings, cron).
- **[ ] `serve` Command:**
  - **[ ]** Implement calling the build process.
  - **[ ]** Implement invoking `wrangler dev` targeting the build directory.
  - **[ ]** Ensure the `[build]` command configuration in the generated `wrangler.toml` correctly points to an internal CLI build command/script.
  - **[ ]** Define and implement the `positronic internal-build` command/entry point for Wrangler to call.
- **[ ] `deploy` Command:**
  - **[ ]** Implement calling the build process.
  - **[ ]** Implement invoking `wrangler deploy` targeting the build directory.
- **[ ] `eject` Command:**
  - **[ ]** Implement final build step.
  - **[ ]** Implement copying build directory contents to user root.
  - **[ ]** Implement adding standard `npm` scripts to `package.json`.
- **[ ] Cron Job Handling:**
  - **[ ]** Read cron definitions from `positronic.config.js`.
  - **[ ]** Generate cron config data (e.g., JSON) during build.
  - **[ ]** Generate a dedicated "Cron Runner Worker" entry point during build. This worker should:
    - Be configured in the generated `wrangler.toml` to run frequently (e.g., `* * * * *` via `[triggers]` - using CF triggers here _is_ simplest for the runner itself).
    - Import the generated cron config data.
    - On trigger, check the config/current time to see if any user workflows need running.
    - If a workflow needs to run, make a POST request to the main Hono API's `/runs` endpoint.
  - **[ ]** Ensure the Cron Runner Worker is included in the build and configured in `wrangler.toml`.

### 1. Core Durable Object (`WorkflowDO`) (Library Component)

- **[X] Basic Structure:**
  - **[X]** Define `WorkflowDO` class extending `DurableObject`.
  - **[X]** Implement `constructor` to initialize `state`, `env`.
  - **[X]** Implement `fetch` handler.
- **[X] Initialization & Workflow Loading:**
  - **[X]** Implement `/init` endpoint logic (or equivalent `start` method called by Hono).
  - **[X]** Store `workflowRunId` passed from Hono.
  - **[X]** Get `workflowName` passed from Hono.
  - **[X]** Load the correct `Workflow` definition object by looking up the `workflowName` in the **globally accessible `runtimeManifest` variable** (set during worker startup).
  - **[ ]** Instantiate `WorkflowRunner`.
  - **[ ]** Instantiate and configure `SQLiteAdapter`.
  - **[ ]** Instantiate and configure `WebSocketAdapter`.
  - **[ ]** Instantiate/Inject `PromptClient` and other `Services` (using `env` bindings).
- **[ ] State Management (Hybrid Approach):**
  - **[ ]** Add `currentState: State | null` property.
  - **[ ]** Implement `ensureWorkflowLoaded()` method:
    - **[ ]** Check if `currentState` is null.
    - **[ ]** If null, query local SQLite DB for completed steps/patches.
    - **[ ]** If null, reconstruct state via `applyPatches`.
    - **[ ]** If null, initialize/resume runner correctly.
  - **[ ]** Modify workflow execution logic to update in-memory `this.currentState`.
- **[ ] WebSocket Handling:**
  - **[ ]** Implement WebSocket upgrade logic in `fetch`.
  - **[ ]** Implement `webSocketMessage` handler.
  - **[ ]** Implement `webSocketClose` handler (remove session).
  - **[ ]** Implement `webSocketError` handler.
  - **[ ]** Use `this.state.acceptWebSocket()` for Hibernatable WebSockets.
  - **[ ]** Manage `this.sessions` array (add on connect, remove on close/error).
  - **[ ]** Integrate `WebSocketAdapter` to broadcast events to `this.sessions`.
- **[ ] Hibernation & Alarms:**
  - **[ ]** Implement `alarm()` handler.
  - **[ ]** Inside `alarm()`, save `this.sessions` to `this.state.storage`.
  - **[ ]** Inside `alarm()`, clear in-memory `this.currentState`.
  - **[ ]** Implement `resetHibernationTimer()` method using `this.state.storage.setAlarm()` and `deleteAlarm()`.
  - **[ ]** Call `resetHibernationTimer()` on relevant activities (init, message received, step processed).
  - **[ ]** Load `this.sessions` from `this.state.storage` in the `constructor`.
- **[ ] Error Handling:**
  - **[ ]** Add robust try/catch blocks around D1 interactions, workflow execution.
  - **[ ]** Handle potential failures during DO initialization.

### 2. SQLite Database & Adapter

- **[ ] Schema Definition:**
  - **[ ]** Finalize `workflow_runs` table schema (id, name, status, error, initial_state?, created_at, completed_at).
  - **[ ]** Finalize `workflow_steps` table schema (id, run_id, title, status, patch, step_order, started_at, completed_at).
  - **[ ]** Consider indexes (on `run_id`, `status` etc.).
- **[ ] `SQLiteAdapter` Implementation:**
  - **[ ]** Create `SQLiteAdapter` class implementing `Adapter` interface.
  - **[ ]** Pass local SQLite DB binding to constructor.
  - **[ ]** Implement `dispatch(event)` method.
  - **[ ]** Implement handlers for each `WorkflowEvent` type (`START`, `STEP_STATUS`, `COMPLETE`, `ERROR`, etc.).
  - **[ ]** Use prepared statements for SQLite interactions.
  - **[ ]** Implement efficient `STEP_STATUS` handling (similar to `SQLiteAdapter`'s transaction/upsert logic).
  - **[ ]** Handle JSON serialization/deserialization for `patch` and `error` fields.
- **[ ] Queries for DO:**
  - **[ ]** Implement SQLite query logic needed by `ensureWorkflowLoaded()` to fetch completed steps/patches for a run ID.

### 3. Hono API Worker

- **[ ] API Endpoint:**
  - **[ ]** Define `/runs` (or similar) POST endpoint.
  - **[ ]** Implement request validation (e.g., checking for workflow name).
- **[ ] DO Interaction:**
  - **[ ]** Get DO namespace binding (`env.DO_NAMESPACE`).
  - **[ ]** Generate unique `workflowRunId`.
  - **[ ]** Get DO ID and DO stub.
  - **[ ]** Call the DO's `/init` endpoint via `fetch`.
  - **[ ]** Handle potential errors from the DO init call.
- **[ ] D1 Interaction:**
  - **[ ]** Create initial `workflow_runs` record.
- **[ ] Response:**
  - **[ ]** Construct the correct `webSocketUrl` (requires knowing the DO's access pattern/hostname).
  - **[ ]** Return `workflowRunId` and `webSocketUrl`.
- **[ ] Authentication/Authorization:**
  - **[ ]** Implement middleware or checks to secure the endpoint.

### 4. Web Client

- **[ ] WebSocket Connection:**
  - **[ ]** Implement logic to establish WebSocket connection using `workflowRunId` / `webSocketUrl`.
  - **[ ]** Handle authentication for the WebSocket connection.
- **[ ] Event Handling:**
  - **[ ]** Process incoming `WorkflowEvent` messages.
  - **[ ]** Update UI dynamically based on events (step status, logs, etc.).
- **[ ] User Input:**
  - **[ ]** Handle `USER_INPUT_REQUIRED` events to display prompts.
  - **[ ]** Capture user responses.
  - **[ ]** Send `USER_INPUT_RESPONSE` messages back via WebSocket.
- **[ ] State Display:**
  - **[ ]** Render relevant parts of the workflow state based on events/patches.

### 5. CLI Tool (`@positronic/cli`)

- **[ ] API Interaction:**
  - **[ ]** Update `handleWorkflowRun` / `handleWorkflowRerun` / `handleRun` to call the Hono API endpoint instead of running locally (when in remote mode).
  - **[ ]** Process the `{ workflowRunId, webSocketUrl }` response.
  - **[ ]** Display the relevant information to the user.
- **[ ] WebSocket Streaming (Optional/Verbose):**
  - **[ ]** Add optional flag (`--stream`?) to connect to the returned `webSocketUrl` and display events in real-time.

### 6. User Project Deployment & Configuration (`wrangler.toml` generated by CLI)

- **[ ] Hono API Setup (in Generated Worker - `.positronic/build/src/index.ts`):**
  - **[ ]** Generated entry point imports Hono setup from `@positronic/cloudflare`.
  - **[ ]** Generated entry point statically imports all user workflows/agents.
  - **[ ]** Generated entry point constructs the `manifest` object mapping names to imported modules.
  - **[ ]** Generated entry point imports `setRuntimeManifest` from `@positronic/cloudflare` and calls it with the `manifest` object during startup.
- **[ ] Durable Object Configuration (in Generated `wrangler.toml`):**
  - **[ ]** CLI generates DO binding pointing to the `WorkflowDO` class imported from `@positronic/cloudflare`.
  - **[ ]** CLI generates necessary bindings (D1, services, secrets) based on `positronic.config.js` or user override `wrangler.toml`.
  - **[ ]** CLI enables `websockets_hibernation` compatibility flag.
- **[ ] Cron Runner Worker Configuration (in Generated `wrangler.toml`):**
  - **[ ]** CLI generates a worker definition for the Cron Runner.
  - **[ ]** CLI adds a `[[triggers]]` section with `crons = ["* * * * *"]` pointing to the Cron Runner Worker.

#### Workflow/Agent Manifest & Registry Explained

How does the `WorkflowDO` (running library code) access and execute the user's specific workflow/agent code _without_ the Hono API passing the whole manifest on every run?

1.  **Bundling is Key:** When the **CLI runs the build process**, the bundler (esbuild) traces all static `import` statements starting from the generated main entry point (`.positronic/build/src/index.ts`).
2.  **Generated Entry Point (`index.ts`):** The **CLI's build process** generates this crucial file within the build directory. It contains:
    - Standard imports for the Hono app and the `WorkflowDO` library components (including a function like `setRuntimeManifest`).
    - **Static `import` statements** for every user workflow/agent discovered in `src/`. This ensures their code is included in the bundle by the bundler.
    - Code to create a `manifest` object (e.g., `workflowRegistry`, `agentRegistry`) mapping string names to the actual module references imported above.
3.  **Setting the Manifest at Startup:** The generated `index.ts` calls `setRuntimeManifest(manifest)` **once** during the worker's initial startup phase. This function, defined in the `@positronic/cloudflare` library (likely near the `WorkflowDO` definition), stores the passed `manifest` object in a module-level variable (let's call it `runtimeManifest`) within the library's module scope.
4.  **Shared Module Scope:** Because the Cloudflare Worker and the Durable Objects it spawns run code from the **same bundled JavaScript file** within the same V8 isolate, the `WorkflowDO` class has access to the module-level scope where it was defined.
5.  **DO Lookup at Runtime:** When the Hono API tells a `WorkflowDO` instance to start (`stub.start(workflowName)`), the `WorkflowDO` code simply accesses the already-populated `runtimeManifest` module-level variable (e.g., `runtimeManifest[workflowName]`). This lookup is fast and returns the direct reference to the bundled user workflow/agent code needed by the `WorkflowRunner`.

This approach avoids passing large manifest objects via `fetch` and leverages JavaScript module scoping within the bundled worker environment.

- **[X] User Project Build Process:** _(Responsibility shifted to CLI)_
  - **[X]** Ensure the **CLI build process** generates a main entry point (`.positronic/build/src/index.ts`) that includes static imports for user code and generates the `manifest` object in-line.
  - **[X]** Ensure the **CLI build process** includes calling `setRuntimeManifest(manifest)` in the generated entry point.
  - **[X]** Ensure the **CLI build process** bundles user definitions, the generated entry point, and the `@positronic/cloudflare` library correctly into the hidden build directory.

### 7. Authentication & Authorization

- **[ ] Hono API:** Define strategy (e.g., Cloudflare Access, API Tokens) and implement.
- **[ ] WebSocket (DO):** Define strategy (e.g., token in URL param checked against secret/binding) and implement in DO's upgrade logic.
