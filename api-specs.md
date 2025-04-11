# Positronic REST API Specifications

This document outlines the REST API endpoints designed to support the Positronic CLI commands.

**Base Path:** `/api/v1` (Assumed)

**Authentication:** (Details TBD - Assumed mechanism like API keys or JWT)

---

## Project Management

_Note: Most project management commands (`add`, `list`, `select`, `show`) appear to manage local client configuration and may not require direct API calls unless fetching project details from a central registry._

---

## Workflow Management

Endpoints related to managing workflows within a selected project. `projectId` is assumed to be known by the client based on the selected project context.

### List Workflows

- **CLI:** `positronic workflow list`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/workflows`
- **Description:** Retrieves a list of all workflows available in the specified project.

### Get Workflow Details

- **CLI:** `positronic workflow show <workflow-name>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/workflows/{workflowName}`
- **Description:** Retrieves detailed information about a specific workflow, including its steps.

### Get Workflow History

- **CLI:** `positronic workflow history <workflow-name>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/workflows/{workflowName}/history`
- **Query Parameters:** `limit` (optional), `offset` (optional)
- **Description:** Retrieves the recent run history for a specific workflow.

### Watch Workflow Run (SSE)

- **CLI:** `positronic workflow watch <workflow-name> --run-id <run-id>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/workflows/{workflowName}/runs/{runId}/watch`
- **Protocol:** Server-Sent Events (SSE) or WebSockets
- **Description:** Streams live updates for a specific workflow run.

---

## Agent Management

Endpoints related to managing agents within a selected project.

### List Agents

- **CLI:** `positronic agent list`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/agents`
- **Description:** Retrieves a list of all agents available in the specified project.

### Get Agent Details

- **CLI:** `positronic agent show <agent-name>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/agents/{agentName}`
- **Description:** Retrieves detailed information about a specific agent.

### Get Agent History

- **CLI:** `positronic agent history <agent-name>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/agents/{agentName}/history`
- **Query Parameters:** `limit` (optional), `offset` (optional)
- **Description:** Retrieves the recent run history for a specific agent.

### Watch Agent Run (SSE)

- **CLI:** `positronic agent watch <agent-name> --run-id <run-id>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/agents/{agentName}/runs/{runId}/watch`
- **Protocol:** Server-Sent Events (SSE) or WebSockets
- **Description:** Streams live updates for a specific agent run.

---

## Prompt Management

Endpoints related to managing prompts within a selected project.

### List Prompts

- **CLI:** `positronic prompt list`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/prompts`
- **Description:** Retrieves a list of all prompts available in the specified project.

### Get Prompt Details

- **CLI:** `positronic prompt show <prompt-name>`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/prompts/{promptName}`
- **Description:** Retrieves detailed information about a specific prompt, potentially including usage statistics (frequency, tokens, cost).

---

## Resource Management

Endpoints related to managing resources within a selected project.

### List Resources

- **CLI:** `positronic resource list`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/resources`
- **Description:** Retrieves a list of all resources available in the specified project.

---

## Service Management

Endpoints related to managing services within a selected project.

### List Services

- **CLI:** `positronic service list`
- **Method:** `GET`
- **Path:** `/projects/{projectId}/services`
- **Description:** Retrieves a list of all services available in the specified project.

---

## Execution Commands

Endpoints related to running workflows or agents remotely.

### Run Workflow

- **CLI:** `positronic run --workflow <workflow-name> [options]`
- **Method:** `POST`
- **Path:** `/projects/{projectId}/workflows/{workflowName}/runs`
- **Request Body:** (JSON) Contains execution options like `restartFrom`, `verbosity`, input parameters, etc.
- **Response Body:** (JSON) Contains the `runId` and initial status.
- **Description:** Initiates a new run of the specified workflow.

### Run Agent

- **CLI:** `positronic run --agent <agent-name> [options]`
- **Method:** `POST`
- **Path:** `/projects/{projectId}/agents/{agentName}/runs`
- **Request Body:** (JSON) Contains execution options and input parameters.
- **Response Body:** (JSON) Contains the `runId` and initial status.
- **Description:** Initiates a new run of the specified agent.

_Note: The generic `positronic run <name-or-path>` command might involve client-side logic to determine whether to call the workflow or agent execution endpoint, or handle local execution if a path is provided._

---

## Project Creation

_Note: The `positronic new <project-name>` command likely involves local file scaffolding and does not require an API call._
