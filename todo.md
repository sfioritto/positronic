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

# List all steps in a specific workflow
positronic workflow show <workflow-name>
```

### Agent Management

```bash
# List all agents in the active project
positronic agent list

# Show details about a specific agent
positronic agent show <agent-name>

# List recent history of a specific agent
positronic agent history <agent-name>
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

4. **Implement agent commands**

   - Define agent structure and interface
   - Implement agent list/run/show/history commands

5. **Improve project creation**

   - Update project template generation
   - Add scaffolding for development.ts and production.ts
   - Create standard directory structure

6. **Polish user experience**
   - Add colorful, interactive components with Ink
   - Implement loading indicators for long-running operations
   - Create helpful error messages and suggestions

## Migration Strategy

- Initially support both old and new command formats
- Deprecate old format with warnings
- Move fully to new command structure after sufficient transition period
