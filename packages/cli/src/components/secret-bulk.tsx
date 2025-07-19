import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import type { PositronicDevServer } from '@positronic/spec';
import * as path from 'path';
import * as fs from 'fs';

interface SecretBulkProps {
  file?: string;
  server?: PositronicDevServer;
}

export const SecretBulk = ({ file = '.env', server }: SecretBulkProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const bulkUploadSecrets = async () => {
      if (!server) {
        setError('No server connection available');
        setLoading(false);
        return;
      }


      try {
        setLoading(true);
        setError(null);

        // Always read from .env file
        const filePath = path.resolve(server.projectRootDir, file);

        if (!fs.existsSync(filePath)) {
          throw new Error(
            `No .env file found at ${filePath}\n\n` +
            'To use this command, create a .env file in your project root with your secrets:\n' +
            '  ANTHROPIC_API_KEY=sk-ant-...\n' +
            '  DATABASE_URL=postgres://...\n' +
            '  REDIS_URL=redis://...'
          );
        }

        // Pass the file path to the backend
        await server.bulkSecrets(filePath);
        setCompleted(true);
        setLoading(false);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to bulk upload secrets');
        setLoading(false);
      }
    };

    bulkUploadSecrets();
  }, [file, server]);

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
        <Text>🔄 Uploading secrets{file ? ` from ${file}` : ' from stdin'}...</Text>
      </Box>
    );
  }

  if (completed) {
    // The bulk command itself outputs success message to console
    // We just need to ensure the component renders something to prevent React errors
    return <Box />;
  }

  return null;
};