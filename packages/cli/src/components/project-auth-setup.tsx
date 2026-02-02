import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { ProjectConfigManager } from '../commands/project-config-manager.js';
import {
  discoverSSHKeys,
  generateSSHKey,
  convertSSHPubKeyToJWK,
  type DiscoveredKey,
} from '../lib/ssh-key-utils.js';
import { resetJwtAuthProvider } from '../lib/jwt-auth.js';
import { SelectList, type SelectListItem } from './select-list.js';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ProjectAuthSetupProps {
  projectDir: string;
  onComplete: () => void;
}

type SetupState =
  | 'checking'
  | 'generating'
  | 'selecting'
  | 'configuring'
  | 'success'
  | 'error';

export const ProjectAuthSetup = ({ projectDir, onComplete }: ProjectAuthSetupProps) => {
  const { exit } = useApp();
  const [state, setState] = useState<SetupState>('checking');
  const [discoveredKeys, setDiscoveredKeys] = useState<DiscoveredKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<DiscoveredKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedKeyPath, setGeneratedKeyPath] = useState<string | null>(null);

  // Check for existing keys on mount
  useEffect(() => {
    const keys = discoverSSHKeys();
    setDiscoveredKeys(keys);

    if (keys.length === 0) {
      // No keys found, generate one
      setState('generating');
    } else if (keys.length === 1) {
      // Auto-select single key
      setSelectedKey(keys[0]);
      setState('configuring');
    } else {
      // Multiple keys, show selection
      setState('selecting');
    }
  }, []);

  // Generate key when in generating state
  useEffect(() => {
    if (state !== 'generating') return;

    const result = generateSSHKey();
    if (result.success) {
      setGeneratedKeyPath(result.path);
      // Re-discover keys to get the newly generated key
      const keys = discoverSSHKeys();
      const newKey = keys.find((k) => k.path === result.path);
      if (newKey) {
        setSelectedKey(newKey);
        setState('configuring');
      } else {
        setError('Generated key but could not find it');
        setState('error');
      }
    } else {
      setError(result.error || 'Failed to generate SSH key');
      setState('error');
    }
  }, [state]);

  // Configure project when key is selected
  useEffect(() => {
    if (state !== 'configuring' || !selectedKey) return;

    try {
      // Convert public key to JWK
      const pubKeyPath = selectedKey.path + '.pub';
      if (!existsSync(pubKeyPath)) {
        setError(`Public key not found at ${pubKeyPath}`);
        setState('error');
        return;
      }

      const keyInfo = convertSSHPubKeyToJWK(pubKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);

      // Write ROOT_PUBLIC_KEY to project .env file
      const envPath = join(projectDir, '.env');
      const envLine = `ROOT_PUBLIC_KEY='${jwkString}'\n`;

      if (existsSync(envPath)) {
        appendFileSync(envPath, envLine);
      } else {
        writeFileSync(envPath, envLine);
      }

      // Set the CLI to use this key globally
      const configManager = new ProjectConfigManager();
      const displayPath = selectedKey.path.replace(process.env.HOME || '', '~');
      configManager.setDefaultPrivateKeyPath(displayPath);

      // Reset JWT provider to use the new key
      resetJwtAuthProvider();

      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure auth');
      setState('error');
    }
  }, [state, selectedKey, projectDir]);

  // Auto-complete on success after a short delay
  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => {
        onComplete();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [state, onComplete]);

  // Checking state
  if (state === 'checking') {
    return (
      <Box flexDirection="column">
        <Text>Checking for SSH keys...</Text>
      </Box>
    );
  }

  // Generating state
  if (state === 'generating') {
    return (
      <Box flexDirection="column">
        <Text>No SSH keys found. Generating a new Ed25519 key...</Text>
      </Box>
    );
  }

  // Selecting state - show key picker
  if (state === 'selecting') {
    const items: SelectListItem[] = discoveredKeys.map((key) => ({
      id: key.path,
      label: key.path.replace(process.env.HOME || '', '~'),
      description: `${key.algorithm} - ${key.fingerprint}${key.comment ? ` (${key.comment})` : ''}`,
    }));

    const handleSelect = (item: SelectListItem) => {
      const key = discoveredKeys.find((k) => k.path === item.id);
      if (key) {
        setSelectedKey(key);
        setState('configuring');
      }
    };

    const handleCancel = () => {
      exit();
    };

    return (
      <SelectList
        items={items}
        header="Select an SSH key to use for this project"
        onSelect={handleSelect}
        onCancel={handleCancel}
        footer="Use arrow keys to navigate, Enter to select, q to cancel"
      />
    );
  }

  // Configuring state
  if (state === 'configuring') {
    return (
      <Box flexDirection="column">
        <Text>Configuring authentication...</Text>
      </Box>
    );
  }

  // Success state
  if (state === 'success' && selectedKey) {
    const displayPath = selectedKey.path.replace(process.env.HOME || '', '~');
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green">Authentication configured!</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>SSH Key:</Text> {displayPath}
          </Text>
          {generatedKeyPath && (
            <Text dimColor>
              (New key generated at {generatedKeyPath})
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Auth setup failed: {error}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            You can manually configure auth later with: px auth login
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
};
