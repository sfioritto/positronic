import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';

interface ProjectAddProps {
  name: string;
  url: string;
  projectConfig: ProjectConfigManager;
}

export const ProjectAdd = ({ name, url, projectConfig }: ProjectAddProps) => {
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    const addResult = projectConfig.addProject(name, url);
    setResult(addResult);
  }, [name, url, projectConfig]);

  if (!result) {
    return <Text>Adding project...</Text>;
  }

  if (result.success) {
    const config = projectConfig.read();
    const isCurrentProject = config.currentProject === name;

    return (
      <Box flexDirection="column">
        <Text color="green">✅ Project "{name}" added successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>URL:</Text> {url}
          </Text>
          {isCurrentProject && (
            <Text>
              <Text bold>Status:</Text> <Text color="cyan">Current project</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            {isCurrentProject
              ? 'This project is now your active project.'
              : `Use "px project select ${name}" to switch to this project.`}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="red">❌ Failed to add project</Text>
      <Box paddingLeft={2}>
        <Text color="red">{result.error}</Text>
      </Box>
    </Box>
  );
};