import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import { ErrorComponent } from './error.js';
import type { PositronicDevServer } from '@positronic/spec';
import * as path from 'path';

interface SecretSyncProps {
  file?: string;
  dryRun?: boolean;
  server?: PositronicDevServer;
}

interface SyncResult {
  created: number;
  updated: number;
  errors?: string[];
  preview?: Array<{ name: string; value: string }>;
}

export const SecretSync = ({ file = '.env', dryRun = false, server }: SecretSyncProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    const syncSecrets = async () => {
      if (!server) {
        setError('No server connection available');
        setLoading(false);
        return;
      }

      if (!server.syncSecrets) {
        setError('Secret sync is not supported by this backend');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Resolve the file path relative to the project root
        const filePath = path.resolve(server.projectRootDir, file);
        
        const result = await server.syncSecrets(filePath, dryRun);
        setSyncResult(result);
        setLoading(false);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to sync secrets');
        setLoading(false);
      }
    };

    syncSecrets();
  }, [file, dryRun, server]);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">❌ Error: {error}</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box>
        <Text>🔄 {dryRun ? 'Reading' : 'Syncing'} secrets from {file}...</Text>
      </Box>
    );
  }

  if (syncResult) {
    if (dryRun && syncResult.preview) {
      return (
        <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <Text bold>🔍 Dry run: Secrets found in {file}:</Text>
          <Box marginTop={1} flexDirection="column">
            {syncResult.preview.map((secret) => (
              <Text key={secret.name}>  • {secret.name}</Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Total: {syncResult.preview.length} secret{syncResult.preview.length !== 1 ? 's' : ''}</Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text bold color="green">✅ Secrets synced successfully!</Text>
        <Box marginTop={1} flexDirection="column">
          {syncResult.created > 0 && (
            <Text>  • Created: {syncResult.created} secret{syncResult.created !== 1 ? 's' : ''}</Text>
          )}
          {syncResult.updated > 0 && (
            <Text>  • Updated: {syncResult.updated} secret{syncResult.updated !== 1 ? 's' : ''}</Text>
          )}
        </Box>
        {syncResult.errors && syncResult.errors.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">⚠️  Errors encountered:</Text>
            {syncResult.errors.map((error, index) => (
              <Text key={index} color="yellow">  • {error}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  return null;
};