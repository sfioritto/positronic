import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { resetJwtAuthProvider } from '../lib/jwt-auth.js';

interface AuthLogoutProps {
  configManager: ProjectConfigManager;
  forProject: boolean;
}

export const AuthLogout = ({ configManager, forProject }: AuthLogoutProps) => {
  const currentProject = configManager.getCurrentProject();

  // If --project flag is used but no project is selected, show error
  if (forProject && !currentProject) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error: No project selected.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Use "px project select" to select a project first, or omit --project to clear the global default key.
          </Text>
        </Box>
      </Box>
    );
  }

  if (forProject && currentProject) {
    // Clear per-project key
    const projectKeyPath = configManager.getProjectPrivateKeyPath(currentProject.name);

    if (!projectKeyPath) {
      return (
        <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <Text>No SSH key configured for project "{currentProject.name}".</Text>
          <Box marginTop={1}>
            <Text dimColor>Nothing to clear.</Text>
          </Box>
        </Box>
      );
    }

    configManager.clearProjectPrivateKeyPath(currentProject.name);
    resetJwtAuthProvider();

    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">
          SSH key cleared for project "{currentProject.name}".
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            The project will now use the global default key (if configured).
          </Text>
        </Box>
      </Box>
    );
  }

  // Clear global default key
  const globalKeyPath = configManager.getDefaultPrivateKeyPath();

  if (!globalKeyPath) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text>No global SSH key configured.</Text>
        <Box marginTop={1}>
          <Text dimColor>Nothing to clear.</Text>
        </Box>
      </Box>
    );
  }

  configManager.clearDefaultPrivateKeyPath();
  resetJwtAuthProvider();

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text color="green">
        Global SSH key configuration cleared.
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          Requests will now use the default key (~/.ssh/id_rsa) unless POSITRONIC_PRIVATE_KEY is set.
        </Text>
      </Box>
    </Box>
  );
};
