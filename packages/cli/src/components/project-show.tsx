import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';

interface ProjectShowProps {
  projectConfig: ProjectConfigManager;
}

export const ProjectShow = ({ projectConfig }: ProjectShowProps) => {
  const currentProject = projectConfig.getCurrentProject();
  const { projects } = projectConfig.listProjects();

  if (!currentProject) {
    return (
      <Box flexDirection="column">
        <Text>No project currently selected.</Text>
        {projects.length > 0 ? (
          <Box marginTop={1}>
            <Text dimColor>
              Use "px project select" to choose from {projects.length} available project{projects.length === 1 ? '' : 's'}.
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>
              Add a project with "px project add &lt;name&gt; --url &lt;url&gt;"
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>Current Project</Text>
      <Box marginTop={1} paddingLeft={2} flexDirection="column">
        <Text>
          <Text bold>Name:</Text> {currentProject.name}
        </Text>
        <Text>
          <Text bold>URL:</Text> {currentProject.url}
        </Text>
        <Text>
          <Text bold>Added:</Text> {new Date(currentProject.addedAt).toLocaleString()}
        </Text>
      </Box>

      {projects.length > 1 && (
        <Box marginTop={1}>
          <Text dimColor>
            {projects.length - 1} other project{projects.length - 1 === 1 ? '' : 's'} available. Use "px project list" to see all.
          </Text>
        </Box>
      )}
    </Box>
  );
};