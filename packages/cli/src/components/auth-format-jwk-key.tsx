import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { convertSSHPubKeyToJWK, expandPath } from '../lib/ssh-key-utils.js';
import { SelectList, type SelectListItem } from './select-list.js';

interface AuthFormatJwkKeyProps {
  pubkeyPath?: string;
}

interface DiscoveredPubKey {
  path: string;
  displayPath: string;
}

type ComponentState = 'selecting' | 'success' | 'error' | 'no-keys';

/**
 * Discover available SSH public keys in ~/.ssh
 */
function discoverSSHPubKeys(): DiscoveredPubKey[] {
  const sshDir = join(homedir(), '.ssh');

  if (!existsSync(sshDir)) {
    return [];
  }

  const pubKeys: DiscoveredPubKey[] = [];

  try {
    const files = readdirSync(sshDir);
    for (const file of files) {
      if (file.endsWith('.pub')) {
        const fullPath = join(sshDir, file);
        pubKeys.push({
          path: fullPath,
          displayPath: `~/.ssh/${file}`,
        });
      }
    }
  } catch {
    return [];
  }

  return pubKeys;
}

/**
 * Copy text to clipboard using pbcopy (macOS) or xclip (Linux)
 */
async function copyToClipboard(text: string): Promise<boolean> {
  const { spawn } = await import('child_process');

  return new Promise((resolve) => {
    // Try pbcopy first (macOS)
    let proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', () => {
      // Try xclip (Linux)
      proc = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.on('error', () => {
        resolve(false);
      });
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.stdin?.write(text);
      proc.stdin?.end();
    });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

export const AuthFormatJwkKey = ({ pubkeyPath }: AuthFormatJwkKeyProps) => {
  const { exit } = useApp();
  const [state, setState] = useState<ComponentState>(pubkeyPath ? 'success' : 'selecting');
  const [error, setError] = useState<string | null>(null);
  const [jwkOutput, setJwkOutput] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [copiedToClipboard, setCopiedToClipboard] = useState<boolean>(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(pubkeyPath || null);

  // Handle direct path provided via --pubkey
  useEffect(() => {
    if (pubkeyPath && state === 'success' && !jwkOutput) {
      processKey(pubkeyPath);
    }
  }, [pubkeyPath, state, jwkOutput]);

  const processKey = async (keyPath: string) => {
    try {
      const expandedPath = expandPath(keyPath);

      if (!existsSync(expandedPath)) {
        setError(`Public key file not found: ${keyPath}`);
        setState('error');
        return;
      }

      const keyInfo = convertSSHPubKeyToJWK(expandedPath);
      const jwkString = JSON.stringify(keyInfo.jwk, null, 2);

      setJwkOutput(jwkString);
      setFingerprint(keyInfo.fingerprint);
      setSelectedPath(keyPath);

      // Try to copy to clipboard
      const copied = await copyToClipboard(jwkString);
      setCopiedToClipboard(copied);

      setState('success');
    } catch (err: any) {
      setError(err.message || 'Failed to convert key');
      setState('error');
    }
  };

  // Check for available keys when in selecting state
  const pubKeys = discoverSSHPubKeys();

  if (state === 'selecting' && pubKeys.length === 0) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="yellow">No SSH public keys found in ~/.ssh/</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Generate a new SSH key with:</Text>
          <Box marginLeft={2} marginTop={1}>
            <Text color="cyan">ssh-keygen -t ed25519 -C "your-email@example.com"</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Or specify a public key path with: px auth format-jwk-key --pubkey /path/to/key.pub
          </Text>
        </Box>
      </Box>
    );
  }

  if (state === 'selecting') {
    const items: SelectListItem[] = pubKeys.map((key) => ({
      id: key.path,
      label: key.displayPath,
      description: '',
    }));

    const handleSelect = async (item: SelectListItem) => {
      await processKey(item.id);
    };

    const handleCancel = () => {
      exit();
    };

    return (
      <SelectList
        items={items}
        header="Select an SSH public key to convert to JWK format"
        onSelect={handleSelect}
        onCancel={handleCancel}
        footer="Use arrow keys to navigate, Enter to select, q to cancel"
      />
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (state === 'success' && jwkOutput) {
    const displayPath = selectedPath?.startsWith(homedir())
      ? selectedPath.replace(homedir(), '~')
      : selectedPath;

    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text bold color="green">JWK Public Key</Text>

        <Box marginTop={1}>
          <Text dimColor>Source: {displayPath}</Text>
        </Box>
        {fingerprint && (
          <Box>
            <Text dimColor>Fingerprint: {fingerprint}</Text>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">{jwkOutput}</Text>
        </Box>

        <Box marginTop={1}>
          {copiedToClipboard ? (
            <Text color="green">Copied to clipboard.</Text>
          ) : (
            <Text color="yellow">Could not copy to clipboard - copy the value above manually.</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Next steps:</Text>
          <Box marginLeft={2} marginTop={1} flexDirection="column">
            <Text>1. Go to Cloudflare dashboard</Text>
            <Text>2. Navigate to Workers & Pages {'>'} Your project {'>'} Settings {'>'} Variables and Secrets</Text>
            <Text>3. Add a new secret named <Text color="cyan">ROOT_PUBLIC_KEY</Text></Text>
            <Text>4. Paste the JWK value above</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return null;
};
