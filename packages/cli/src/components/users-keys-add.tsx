import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiPost, useApiGet } from '../hooks/useApi.js';
import {
  convertSSHPubKeyToJWK,
  convertSSHPubKeyStringToJWK,
} from '../lib/ssh-key-utils.js';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface UsersKeysAddProps {
  userName: string;
  pubkeyPath?: string;
  paste?: boolean;
  label?: string;
}

interface UserKey {
  fingerprint: string;
  userName: string;
  label: string;
  addedAt: number;
}

interface User {
  name: string;
  createdAt: number;
}

export const UsersKeysAdd = ({
  userName,
  pubkeyPath,
  paste,
  label,
}: UsersKeysAddProps) => {
  const {
    data: user,
    loading: loadingUser,
    error: userError,
  } = useApiGet<User>(`/users/${userName}`);
  const { data, loading, error, execute } = useApiPost<UserKey>(
    `/users/${userName}/keys`
  );
  const [added, setAdded] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<{
    fingerprint: string;
    algorithm: string;
  } | null>(null);
  const [pasteMode, setPasteMode] = useState(paste && !pubkeyPath);
  const [pastedKey, setPastedKey] = useState('');
  const [pasteSubmitted, setPasteSubmitted] = useState(false);

  useInput(
    (input, key) => {
      if (!pasteMode || pasteSubmitted) return;

      if (key.return) {
        setPasteSubmitted(true);
        return;
      }

      if (key.backspace || key.delete) {
        setPastedKey((prev) => prev.slice(0, -1));
        return;
      }

      if (input) {
        setPastedKey((prev) => prev + input);
      }
    },
    { isActive: pasteMode && !pasteSubmitted }
  );

  useEffect(() => {
    if (!user || added || parseError) return;
    if (pasteMode && !pasteSubmitted) return;

    if (pasteMode && pasteSubmitted && pastedKey) {
      try {
        const { jwk, fingerprint, algorithm } = convertSSHPubKeyStringToJWK(
          pastedKey.trim()
        );
        setKeyInfo({ fingerprint, algorithm });
        execute({ jwk, fingerprint, label: label || '' })
          .then(() => setAdded(true))
          .catch(() => {});
      } catch (err: any) {
        setParseError(err.message || 'Failed to parse SSH public key');
      }
      return;
    }

    if (pubkeyPath) {
      let resolvedPath = pubkeyPath;
      if (resolvedPath.startsWith('~')) {
        resolvedPath = join(homedir(), resolvedPath.slice(1));
      }

      if (!existsSync(resolvedPath)) {
        setParseError(`Public key file not found: ${resolvedPath}`);
        return;
      }

      try {
        const { jwk, fingerprint, algorithm } =
          convertSSHPubKeyToJWK(resolvedPath);
        setKeyInfo({ fingerprint, algorithm });
        execute({ jwk, fingerprint, label: label || '' })
          .then(() => setAdded(true))
          .catch(() => {});
      } catch (err: any) {
        setParseError(err.message || 'Failed to parse SSH public key');
      }
    }
  }, [
    user,
    added,
    pubkeyPath,
    label,
    execute,
    parseError,
    pasteMode,
    pasteSubmitted,
    pastedKey,
  ]);

  if (userError) {
    return <ErrorComponent error={userError} />;
  }

  if (parseError) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error parsing public key: {parseError}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Make sure the file is a valid SSH public key (e.g., id_rsa.pub,
            id_ed25519.pub)
          </Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loadingUser) {
    return (
      <Box>
        <Text>Loading user...</Text>
      </Box>
    );
  }

  if (!user) {
    return (
      <Box>
        <Text color="red">User not found: {userName}</Text>
      </Box>
    );
  }

  if (pasteMode && !pasteSubmitted) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text>
          Paste your SSH public key and press <Text bold>Enter</Text>:
        </Text>
        <Box marginTop={1}>
          <Text>{pastedKey || '...'}</Text>
        </Box>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box>
        <Text>Adding key to user "{user.name}"...</Text>
      </Box>
    );
  }

  if (data && keyInfo) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">Key added successfully!</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>User:</Text> {user.name}
          </Text>
          <Text>
            <Text bold>Algorithm:</Text> {keyInfo.algorithm.toUpperCase()}
          </Text>
          <Text>
            <Text bold>Fingerprint:</Text> {keyInfo.fingerprint}
          </Text>
          {label && (
            <Text>
              <Text bold>Label:</Text> {label}
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  return null;
};
