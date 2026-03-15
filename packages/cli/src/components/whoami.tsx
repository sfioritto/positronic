import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { resolvePrivateKeyPath } from '../lib/ssh-key-utils.js';
import { readLocalAuth } from '../lib/local-auth.js';

interface WhoamiProps {
  configManager: ProjectConfigManager;
  projectRootPath?: string;
}

interface WhoamiResponse {
  name: string;
  isRoot: boolean;
}

export const Whoami = ({ configManager, projectRootPath }: WhoamiProps) => {
  const { data, loading, error } = useApiGet<WhoamiResponse>('/auth/whoami');

  // Determine local key info
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  const localKeyPath = projectRootPath ? readLocalAuth(projectRootPath) : null;
  let configuredPath: string | null;
  if (envPath) {
    configuredPath = envPath;
  } else if (localKeyPath) {
    configuredPath = localKeyPath;
  } else {
    configuredPath = configManager.getPrivateKeyPath();
  }
  const activeKeyPath = resolvePrivateKeyPath(configuredPath);

  let keySource: string;
  if (envPath) {
    keySource = 'environment variable';
  } else if (localKeyPath) {
    keySource = 'local project';
  } else {
    const globalKeyPath = configManager.getDefaultPrivateKeyPath();
    const currentProject = configManager.getCurrentProject();
    const projectKeyPath = currentProject
      ? configManager.getProjectPrivateKeyPath(currentProject.name)
      : undefined;
    if (projectKeyPath && currentProject) {
      keySource = `project "${currentProject.name}"`;
    } else if (globalKeyPath) {
      keySource = 'global config';
    } else {
      keySource = 'default fallback';
    }
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Checking identity...</Text>
      </Box>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text>
        <Text bold>Logged in as:</Text> <Text color="green">{data.name}</Text>
        {data.isRoot && <Text dimColor> (root)</Text>}
      </Text>
      <Box marginTop={1} flexDirection="column" paddingLeft={2}>
        <Text>
          <Text bold>Key:</Text> {activeKeyPath}
        </Text>
        <Text>
          <Text bold>Source:</Text> <Text dimColor>{keySource}</Text>
        </Text>
      </Box>
    </Box>
  );
};
