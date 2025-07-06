import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';

interface ProjectListProps {
  projectConfig: ProjectConfigManager;
}

export const ProjectList = ({ projectConfig }: ProjectListProps) => {
  const { projects, current } = projectConfig.listProjects();

  if (projects.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No projects configured.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Add a project with "px project add &lt;name&gt; --url &lt;url&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Calculate column widths for table display
  const maxNameLength = Math.max(...projects.map(p => p.name.length), 4); // min 4 for "Name"
  const nameColWidth = Math.min(maxNameLength + 2, 30); // cap at 30

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {projects.length} project{projects.length === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">{padRight('Name', nameColWidth)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">URL</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(nameColWidth + 2 + 40)}</Text>
        </Box>

        {/* Project rows */}
        {projects.map((project) => {
          const isCurrent = project.name === current;

          return (
            <Box key={project.name}>
              <Text color={isCurrent ? 'green' : undefined}>
                {padRight(truncate(project.name, nameColWidth - 2), nameColWidth)}
              </Text>
              <Text>  </Text>
              <Text dimColor={!isCurrent}>{project.url}</Text>
              {isCurrent && <Text color="green"> ← current</Text>}
            </Box>
          );
        })}
      </Box>

      {!current && projects.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            No project selected. Use "px project select &lt;name&gt;" to select one.
          </Text>
        </Box>
      )}
    </Box>
  );
};

function padRight(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
}