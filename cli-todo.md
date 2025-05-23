# Positronic CLI Redesign To-Do List

## Overview

- Rebuild the CLI using Yargs for command parsing and argument handling
- Use Ink for interactive UI components and improved user experience
- Restructure commands around logical groupings (project, workflow, agent)
- Implement project selection concept for seamless switching between local and cloud contexts

## Command Structure

### Project Management

```bash
# Add a remote project to your list of projects
positronic project add <name> --url <url>

# Add a local project to your list of projects
positronic project add <name> --path <path>

# Add a project with both remote and local versions
positronic project add <name> --url <url> --path <path>

# List all your configured projects
positronic project list

# Switch to using a project's remote version or local version if there's no remote version
# There will be a visual indicator if remote or local is being used when switching projects
positronic project select <name>

# Switch to using a project's local version
positronic project select <name> --local

# Interactive project selection (if no name provided)
positronic project select

# Use the current directory as a local project
positronic project select --path .

# Display your currently active project and mode (local/remote)
positronic project show
```

### Workflow Management

```bash
# List all workflows in the active project
positronic workflow list

# List recent history of a specific workflow
positronic workflow history <workflow-name>

# List all steps in a specific workflow and other details
positronic workflow show <workflow-name>

# Watch a specific workflow run for updates
positronic workflow watch <workflow-name> --run-id <run-id>
```

### Agent Management

```bash
# List all agents in the active project
positronic agent list

# Show details about a specific agent
positronic agent show <agent-name>

# List recent history of a specific agent
positronic agent history <agent-name>

# Watch a specific agent run for updates
positronic agent watch <agent-name> --run-id <run-id>
```

### Prompt Management

```bash
# List all prompts in the active project
positronic prompt list

# Show prompt details including usage statistics
# (frequency of calls, token usage, total cost)
positronic prompt show <prompt-name>
```

### Resource Management

```bash
# List all resources in the active project
positronic resource list
```

### Service Management

```bash
# List all services in the active project
positronic service list
```

### Execution Commands

```bash
# Run a workflow or agent by name (or path for local development)
positronic run <name-or-path>

# Specify workflow or agent type explicitly
positronic run --workflow <workflow-name>
positronic run --agent <agent-name>

# Run with additional options
positronic run <name> --restart-from=3 -v
```

### Project Creation

```bash
# Create a new positronic project
positronic new <project-name>
```

## Implementation Tasks

1. **Set up environment**

   - Install and configure Yargs for command parsing
   - Install and set up Ink for UI components

2. **Implement project management**

   - Create configuration storage (in user home directory)
   - Implement project add/list/select/show commands
   - Create project detection logic for local directories

3. **Implement workflow commands**

   - Refactor workflow discovery/loading logic
   - Implement workflow list/history/steps/run commands
   - Create workflow runner that works with both local and cloud workflows
   - Implement workflow watch command with SSE connection
   - Implement workflow watch command to show live updates for a run

4. **Implement agent commands**

   - Define agent structure and interface
   - Implement agent list/run/show/history commands
   - Implement agent watch command with SSE connection
   - Implement agent watch command to show live updates for a run

5. **Implement prompt commands**

   - Define prompt interface and metadata structure
   - Implement prompt list/show commands
   - Create usage tracking and cost calculation features
   - Display statistics about call frequency, token usage, and costs

6. **Implement resource commands**

   - Define resource interface and metadata
   - Implement resource list command

7. **Implement service commands**

   - Define service interface and metadata
   - Implement service list command

8. **Improve project creation**

   - Update project template generation
   - Add scaffolding for development.ts and production.ts
   - Create standard directory structure

9. **Polish user experience**
   - Add colorful, interactive components with Ink
   - Implement loading indicators for long-running operations
   - Create helpful error messages and suggestions
