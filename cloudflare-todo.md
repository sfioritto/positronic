# Positronic Cloudflare Architecture: Flow & To-Do

This document outlines the intended end-to-end flow for running Positronic workflows on Cloudflare, incorporating D1 for primary state and delayed hibernation for Durable Objects. It also includes a checklist for implementation.

## Updated End-to-End Flow Simulation (D1 State & Delayed Hibernation)

1.  **User (CLI):** Initiates a run: `positronic run my-workflow --verbose`.
2.  **CLI (`positronic.ts`):**
    - Parses the command.
    - Determines the target Hono API endpoint (local dev or remote prod).
    - Makes an authenticated POST request to Hono (e.g., `/runs`) with workflow name (`my-workflow`).
3.  **Hono API Worker:**
    - Authenticates/Authorizes the request.
    - Validates the workflow name (`my-workflow`) against bundled manifest or D1 registry.
    - Generates a unique `workflowRunId`.
    - **D1 Write:** Creates an initial record in `workflow_runs` table (id, name, status='INITIALIZING', started_at).
    - Constructs the Durable Object ID (from `workflowRunId`).
    - Gets the DO stub: `env.DO_NAMESPACE.get(doId)`.
    - Sends an internal `fetch` request (`POST /init`) to the DO, passing `workflowRunId`, workflow name, and necessary configurations/secrets. This activates the DO.
    - Constructs and returns the `workflowRunId` and the specific `webSocketUrl` for the DO to the CLI.
4.  **CLI (`positronic.ts`):**
    - Prints the `workflowRunId` and `webSocketUrl` to the user.
5.  **Durable Object (Activation & Init):**
    - DO instance activates. `constructor` runs.
    - `constructor` loads WebSocket sessions from DO storage: `this.state.storage.get('sessions')`.
    - The `/init` handler receives the fetch request from Hono.
    - Stores `workflowRunId`.
    - **D1 Read (State Load):** Queries D1 for any existing completed steps for this `workflowRunId` (likely none on initial init, but important for restarts/wake-ups).
    - Reconstructs `this.currentState` by applying patches from completed steps found in D1.
    - Sets up `WorkflowRunner`, loads the specific `Workflow` definition (from bundled manifest), configures `PromptClient`, `D1Adapter`, `WebSocketAdapter`, and services.
    - **Starts Run:** Calls `workflowRunner.run({ initialState: this.currentState, ..., client })`.
    - **Sets Timer:** Calls `this.resetHibernationTimer()` to set the initial 5-minute inactivity alarm.
6.  **Durable Object (Active Execution Loop):**
    - The runner yields `WorkflowEvent`s.
    - For each event:
      - `D1Adapter` persists the event/patch/status update to D1 tables (`workflow_runs`, `workflow_steps`).
      - `WebSocketAdapter` broadcasts the event to all connected clients listed in `this.sessions`.
      - The workflow logic updates the **in-memory `this.currentState`**.
      - Calls `this.resetHibernationTimer()` to postpone hibernation due to activity.
7.  **User (Web Client):** Connects via the `webSocketUrl`.
8.  **Web Client:** Establishes an authenticated WebSocket connection.
9.  **Durable Object (WebSocket Connection):**
    - `fetch` handler receives the upgrade request.
    - Authenticates the connection.
    - Accepts the WebSocket: `this.state.acceptWebSocket(serverSocket)`.
    - Adds the `serverSocket` to the `this.sessions` array (in-memory).
    - _Optional:_ Queries D1 for current step status/history and sends it to the newly connected client.
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
    - Workflow resumes, generating new events, updating in-memory `this.currentState`, persisting to D1 via adapter, broadcasting via WebSockets.
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
      - **D1 Read (State Load):** Queries D1 for `initialState` and all `COMPLETE` `SerializedStep`s for the `workflowRunId`.
      - Reconstructs `this.currentState` by applying patches from D1 steps.
      - Re-initializes the `WorkflowRunner` to resume from the step _after_ the last completed one found in D1.
    - Calls `this.resetHibernationTimer()`.
    - Processes the user input, feeding it to the resumed workflow runner.
    - Execution continues as in step 16.
22. **Workflow End:**
    - Runner yields `COMPLETE` or `ERROR`.
    - `D1Adapter` writes final status/error to `workflow_runs`.
    - `WebSocketAdapter` broadcasts final event.
    - `this.resetHibernationTimer()` might be called one last time.
    - Eventually, the inactivity alarm fires, sessions are saved, and the DO hibernates.

## Implementation To-Do List

### 1. Core Durable Object (`WorkflowDO`)

- **[ ] Basic Structure:**
  - **[ ]** Define `WorkflowDO` class extending `DurableObject`.
  - **[ ]** Implement `constructor` to initialize `state`, `env`.
  - **[ ]** Implement `fetch` handler.
- **[ ] Initialization & Workflow Loading:**
  - **[ ]** Implement `/init` endpoint logic within `fetch` (or separate method called by fetch).
  - **[ ]** Store `workflowRunId` passed from Hono.
  - **[ ]** Implement workflow manifest/registry lookup (based on bundled code).
  - **[ ]** Load the correct `Workflow` definition object.
  - **[ ]** Instantiate `WorkflowRunner`.
  - **[ ]** Instantiate and configure `D1Adapter`.
  - **[ ]** Instantiate and configure `WebSocketAdapter`.
  - **[ ]** Instantiate/Inject `PromptClient` and other `Services` (using `env` bindings).
- **[ ] State Management (Hybrid Approach):**
  - **[ ]** Add `currentState: State | null` property.
  - **[ ]** Implement `ensureWorkflowLoaded()` method:
    - **[ ]** Check if `currentState` is null.
    - **[ ]** If null, query D1 for completed steps/patches.
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

### 2. D1 Database & Adapter

- **[ ] Schema Definition:**
  - **[ ]** Finalize `workflow_runs` table schema (id, name, status, error, initial_state?, created_at, completed_at).
  - **[ ]** Finalize `workflow_steps` table schema (id, run_id, title, status, patch, step_order, started_at, completed_at).
  - **[ ]** Consider indexes (on `run_id`, `status` etc.).
- **[ ] `D1Adapter` Implementation:**
  - **[ ]** Create `D1Adapter` class implementing `Adapter` interface.
  - **[ ]** Pass D1 binding (`env.DB`) to constructor.
  - **[ ]** Implement `dispatch(event)` method.
  - **[ ]** Implement handlers for each `WorkflowEvent` type (`START`, `STEP_STATUS`, `COMPLETE`, `ERROR`, etc.).
  - **[ ]** Use prepared statements for D1 interactions.
  - **[ ]** Implement efficient `STEP_STATUS` handling (similar to `SQLiteAdapter`'s transaction/upsert logic).
  - **[ ]** Handle JSON serialization/deserialization for `patch` and `error` fields.
- **[ ] Queries for DO:**
  - **[ ]** Implement D1 query logic needed by `ensureWorkflowLoaded()` to fetch completed steps/patches for a run ID.

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

### 6. Deployment & Configuration (`wrangler.toml`)

- **[ ] Hono Worker:**
  - **[ ]** Configure worker entry point.
  - **[ ]** Bind D1 database.
  - **[ ]** Bind DO namespace.
  - **[ ]** Configure routes.
  - **[ ]** Add necessary secrets (API keys, etc.).
- **[ ] Durable Object Worker:**
  - **[ ]** Define DO class name and script name.
  - **[ ]** Configure DO migrations (if needed).
  - **[ ]** Bind D1 database.
  - **[ ]** Bind any necessary services or secrets (e.g., LLM API keys).
  - **[ ]** Enable `websockets_hibernation` compatibility flag.
- **[ ] Build Process:**
  - **[ ]** Ensure the build process bundles the Positronic framework, workflow/agent manifest, and all definitions into the DO worker script.

### 7. Authentication & Authorization

- **[ ] Hono API:** Define strategy (e.g., Cloudflare Access, API Tokens) and implement.
- **[ ] WebSocket (DO):** Define strategy (e.g., token in URL param checked against secret/binding) and implement in DO's upgrade logic.
