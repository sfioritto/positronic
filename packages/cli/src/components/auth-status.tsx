import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { resolvePrivateKeyPath } from '../lib/ssh-key-utils.js';
import { readLocalAuth } from '../lib/local-auth.js';
import { existsSync } from 'fs';

interface AuthStatusProps {
  configManager: ProjectConfigManager;
  projectRootPath?: string;
}

export const AuthStatus = ({ configManager, projectRootPath }: AuthStatusProps) => {
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  const globalKeyPath = configManager.getDefaultPrivateKeyPath();
  const currentProject = configManager.getCurrentProject();
  const projectKeyPath = currentProject
    ? configManager.getProjectPrivateKeyPath(currentProject.name)
    : undefined;
  const localKeyPath = projectRootPath ? readLocalAuth(projectRootPath) : null;

  // Determine the active key path following the full priority chain:
  // 1. Env var
  // 2. Local project auth (.positronic-auth.json)
  // 3. Per-project key from global config
  // 4. Global default key
  // 5. Fallback
  let configuredPath: string | null;
  if (envPath) {
    configuredPath = envPath;
  } else if (localKeyPath) {
    configuredPath = localKeyPath;
  } else {
    configuredPath = configManager.getPrivateKeyPath();
  }
  const activeKeyPath = resolvePrivateKeyPath(configuredPath);
  const keyExists = existsSync(activeKeyPath);

  // Determine which source is being used
  let activeSource: string;
  if (envPath) {
    activeSource = 'environment variable';
  } else if (localKeyPath) {
    activeSource = 'local project';
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

        {/* Local project key */}
        {projectRootPath && (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold>Local Project Key:</Text>{' '}
              {localKeyPath ? (
                <Text color="cyan">{localKeyPath}</Text>
              ) : (
                <Text dimColor>not configured</Text>
              )}
            </Text>
          </Box>
        )}

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

      {!globalKeyPath && !envPath && !projectKeyPath && !localKeyPath && (
        <Box marginTop={1}>
          <Text dimColor>
            Run "px auth login" to configure your SSH key for authentication.
          </Text>
        </Box>
      )}
    </Box>
  );
};
