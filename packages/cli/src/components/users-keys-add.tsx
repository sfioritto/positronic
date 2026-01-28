import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiPost, useApiGet } from '../hooks/useApi.js';
import { convertSSHPubKeyToJWK } from '../lib/ssh-key-utils.js';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface UsersKeysAddProps {
  userId: string;
  pubkeyPath: string;
  label?: string;
}

interface UserKey {
  fingerprint: string;
  userId: string;
  label: string;
  addedAt: number;
}

interface User {
  id: string;
  name: string;
  createdAt: number;
}

export const UsersKeysAdd = ({ userId, pubkeyPath, label }: UsersKeysAddProps) => {
  const { data: user, loading: loadingUser, error: userError } = useApiGet<User>(`/users/${userId}`);
  const { data, loading, error, execute } = useApiPost<UserKey>(`/users/${userId}/keys`);
  const [added, setAdded] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<{ fingerprint: string; algorithm: string } | null>(null);

  useEffect(() => {
    if (!added && user && !parseError) {
      // Resolve the path
      let resolvedPath = pubkeyPath;
      if (resolvedPath.startsWith('~')) {
        resolvedPath = join(homedir(), resolvedPath.slice(1));
      }

      // Check if file exists
      if (!existsSync(resolvedPath)) {
        setParseError(`Public key file not found: ${resolvedPath}`);
        return;
      }

      try {
        // Convert SSH public key to JWK
        const { jwk, fingerprint, algorithm } = convertSSHPubKeyToJWK(resolvedPath);
        setKeyInfo({ fingerprint, algorithm });

        // Upload the key
        execute({ jwk, fingerprint, label: label || '' })
          .then(() => setAdded(true))
          .catch(() => {});
      } catch (err: any) {
        setParseError(err.message || 'Failed to parse SSH public key');
      }
    }
  }, [user, added, pubkeyPath, label, execute, parseError]);

  if (userError) {
    return <ErrorComponent error={userError} />;
  }

  if (parseError) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="red">Error parsing public key: {parseError}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Make sure the file is a valid SSH public key (e.g., id_rsa.pub, id_ed25519.pub)
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
        <Text color="red">User not found: {userId}</Text>
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
