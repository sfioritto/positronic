import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { discoverSSHKeys, resolvePrivateKeyPath } from '../lib/ssh-key-utils.js';
import { readLocalAuth } from '../lib/local-auth.js';

interface AuthListProps {
  configManager: ProjectConfigManager;
  projectRootPath?: string;
}

export const AuthList = ({ configManager, projectRootPath }: AuthListProps) => {
  const discoveredKeys = discoverSSHKeys();

  // Get the currently active key path for comparison, including local auth
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  let configuredPath: string | null;
  if (envPath) {
    configuredPath = envPath;
  } else if (projectRootPath) {
    const localKeyPath = readLocalAuth(projectRootPath);
    configuredPath = localKeyPath || configManager.getPrivateKeyPath();
  } else {
    configuredPath = configManager.getPrivateKeyPath();
  }
  const activeKeyPath = resolvePrivateKeyPath(configuredPath);

  if (discoveredKeys.length === 0) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="yellow">No SSH keys found in ~/.ssh/</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Generate a new SSH key with: ssh-keygen -t ed25519
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>Available SSH Keys ({discoveredKeys.length}):</Text>

      <Box marginTop={1} flexDirection="column">
        {discoveredKeys.map((key, index) => {
          const displayPath = key.path.replace(process.env.HOME || '', '~');
          const isActive = key.path === activeKeyPath;

          return (
            <Box key={key.path} flexDirection="column" marginBottom={1}>
              <Text>
                {isActive ? (
                  <Text color="green">* </Text>
                ) : (
                  <Text>  </Text>
                )}
                <Text bold color={isActive ? 'green' : undefined}>
                  {displayPath}
                </Text>
              </Text>
              <Box paddingLeft={4}>
                <Text dimColor>
                  {key.algorithm} - {key.fingerprint}
                  {key.comment ? ` (${key.comment})` : ''}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          * = currently active key
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          Run "px auth login" to configure which key to use.
        </Text>
      </Box>
    </Box>
  );
};
