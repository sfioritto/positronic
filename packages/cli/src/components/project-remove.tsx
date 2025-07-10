import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';

interface ProjectRemoveProps {
  name: string;
  projectConfig: ProjectConfigManager;
}

export const ProjectRemove = ({ name, projectConfig }: ProjectRemoveProps) => {
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    const removeResult = projectConfig.removeProject(name);
    setResult(removeResult);
  }, [name, projectConfig]);

  if (!result) {
    return <Text>Removing project...</Text>;
  }

  if (result.success) {
    const config = projectConfig.read();
    const currentProject = config.currentProject;

    return (
      <Box flexDirection="column">
        <Text color="green">✅ Project "{name}" removed successfully!</Text>
        {currentProject && (
          <Box marginTop={1} paddingLeft={2}>
            <Text>
              <Text bold>Current project:</Text> <Text color="cyan">{currentProject}</Text>
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            {currentProject
              ? `Your active project is now "${currentProject}".`
              : 'No active project selected. Use "px project select <name>" to choose one.'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="red">❌ Failed to remove project</Text>
      <Box paddingLeft={2}>
        <Text color="red">{result.error}</Text>
      </Box>
    </Box>
  );
};