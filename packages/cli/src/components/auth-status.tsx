import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { resolvePrivateKeyPath, expandPath } from '../lib/ssh-key-utils.js';
import { existsSync } from 'fs';

interface AuthStatusProps {
  configManager: ProjectConfigManager;
}

export const AuthStatus = ({ configManager }: AuthStatusProps) => {
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  const globalKeyPath = configManager.getDefaultPrivateKeyPath();
  const currentProject = configManager.getCurrentProject();
  const projectKeyPath = currentProject
    ? configManager.getProjectPrivateKeyPath(currentProject.name)
    : undefined;

  // Determine the active key path (what will actually be used)
  const configuredPath = configManager.getPrivateKeyPath();
  const activeKeyPath = resolvePrivateKeyPath(configuredPath);
  const keyExists = existsSync(activeKeyPath);

  // Determine which source is being used
  let activeSource: string;
  if (envPath) {
    activeSource = 'environment variable';
  } else if (projectKeyPath && currentProject) {
    activeSource = `project "${currentProject.name}"`;
  } else if (globalKeyPath) {
    activeSource = 'global config';
  } else {
    activeSource = 'default fallback';
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>Authentication Configuration</Text>

      <Box marginTop={1} flexDirection="column" paddingLeft={2}>
        {/* Environment variable */}
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold>Environment Variable:</Text>{' '}
            {envPath ? (
              <Text color="cyan">{envPath}</Text>
            ) : (
              <Text dimColor>not set</Text>
            )}
          </Text>
          {envPath && (
            <Box paddingLeft={2}>
              <Text dimColor>
                (POSITRONIC_PRIVATE_KEY - highest priority)
              </Text>
            </Box>
          )}
        </Box>

        {/* Global default key */}
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold>Global Default Key:</Text>{' '}
            {globalKeyPath ? (
              <Text color="cyan">{globalKeyPath}</Text>
            ) : (
              <Text dimColor>not configured</Text>
            )}
          </Text>
        </Box>

        {/* Per-project key */}
        {currentProject && (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold>Project Key ({currentProject.name}):</Text>{' '}
              {projectKeyPath ? (
                <Text color="cyan">{projectKeyPath}</Text>
              ) : (
                <Text dimColor>not configured (uses global)</Text>
              )}
            </Text>
          </Box>
        )}

        {/* Active key summary */}
        <Box marginTop={1} flexDirection="column">
          <Text bold>Active Key:</Text>
          <Box paddingLeft={2} flexDirection="column">
            <Text>
              Path: <Text color={keyExists ? 'green' : 'red'}>{activeKeyPath}</Text>
            </Text>
            <Text>
              Source: <Text dimColor>{activeSource}</Text>
            </Text>
            <Text>
              Status:{' '}
              {keyExists ? (
                <Text color="green">key file found</Text>
              ) : (
                <Text color="red">key file not found</Text>
              )}
            </Text>
          </Box>
        </Box>
      </Box>

      {!globalKeyPath && !envPath && !projectKeyPath && (
        <Box marginTop={1}>
          <Text dimColor>
            Run "px auth login" to configure your SSH key for authentication.
          </Text>
        </Box>
      )}
    </Box>
  );
};
