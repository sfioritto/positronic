import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { ProjectConfigManager } from '../commands/project-config-manager.js';
import { discoverSSHKeys, expandPath } from '../lib/ssh-key-utils.js';
import { resetRequestSigner } from '../lib/request-signer.js';
import { SelectList, type SelectListItem } from './select-list.js';
import { existsSync } from 'fs';

interface AuthLoginProps {
  configManager: ProjectConfigManager;
  keyPath?: string;
  forProject: boolean;
}

type LoginState = 'selecting' | 'success' | 'error';

export const AuthLogin = ({ configManager, keyPath, forProject }: AuthLoginProps) => {
  const { exit } = useApp();
  const [state, setState] = useState<LoginState>(keyPath ? 'success' : 'selecting');
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(keyPath || null);

  const currentProject = configManager.getCurrentProject();

  // If --project flag is used but no project is selected, show error
  if (forProject && !currentProject) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error: No project selected.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Use "px project select" to select a project first, or omit --project to set the global default key.
          </Text>
        </Box>
      </Box>
    );
  }

  // If --path is provided, validate and set directly
  if (keyPath && state === 'success') {
    const expandedPath = expandPath(keyPath);
    if (!existsSync(expandedPath)) {
      return (
        <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <Text color="red">Error: Key file not found at {keyPath}</Text>
          <Box marginTop={1}>
            <Text dimColor>Please verify the path and try again.</Text>
          </Box>
        </Box>
      );
    }

    // Set the key
    if (forProject && currentProject) {
      const result = configManager.setProjectPrivateKeyPath(currentProject.name, keyPath);
      if (!result.success) {
        return (
          <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
            <Text color="red">Error: {result.error}</Text>
          </Box>
        );
      }
    } else {
      configManager.setDefaultPrivateKeyPath(keyPath);
    }

    // Reset request signer to use new key
    resetRequestSigner();

    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">
          SSH key configured successfully.
        </Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text>
            <Text bold>Path:</Text> {keyPath}
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text>
            <Text bold>Scope:</Text>{' '}
            {forProject && currentProject ? `project "${currentProject.name}"` : 'global'}
          </Text>
        </Box>
      </Box>
    );
  }

  // Interactive key selection
  if (state === 'selecting') {
    const discoveredKeys = discoverSSHKeys();

    if (discoveredKeys.length === 0) {
      return (
        <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <Text color="yellow">No SSH keys found in ~/.ssh/</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Generate a new SSH key with: ssh-keygen -t ed25519
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Or specify a custom path with: px auth login --path /path/to/key
            </Text>
          </Box>
        </Box>
      );
    }

    const items: SelectListItem[] = discoveredKeys.map((key) => ({
      id: key.path,
      label: key.path.replace(process.env.HOME || '', '~'),
      description: `${key.algorithm} - ${key.fingerprint}${key.comment ? ` (${key.comment})` : ''}`,
    }));

    const handleSelect = (item: SelectListItem) => {
      const originalPath = item.id;
      // Store with ~ prefix for portability
      const displayPath = originalPath.replace(process.env.HOME || '', '~');

      if (forProject && currentProject) {
        const result = configManager.setProjectPrivateKeyPath(currentProject.name, displayPath);
        if (!result.success) {
          setError(result.error || 'Unknown error');
          setState('error');
          return;
        }
      } else {
        configManager.setDefaultPrivateKeyPath(displayPath);
      }

      // Reset request signer to use new key
      resetRequestSigner();

      setSelectedPath(displayPath);
      setState('success');
    };

    const handleCancel = () => {
      exit();
    };

    return (
      <SelectList
        items={items}
        header={`Select an SSH key${forProject && currentProject ? ` for project "${currentProject.name}"` : ' (global)'}`}
        onSelect={handleSelect}
        onCancel={handleCancel}
        footer="Use arrow keys to navigate, Enter to select, q to cancel"
      />
    );
  }

  if (state === 'success' && selectedPath) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">
          SSH key configured successfully.
        </Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text>
            <Text bold>Path:</Text> {selectedPath}
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text>
            <Text bold>Scope:</Text>{' '}
            {forProject && currentProject ? `project "${currentProject.name}"` : 'global'}
          </Text>
        </Box>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  return null;
};
