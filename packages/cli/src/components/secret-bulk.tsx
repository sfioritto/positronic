import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiPost } from '../hooks/useApi.js';
import * as path from 'path';
import * as fs from 'fs';

interface SecretBulkProps {
  file?: string;
  projectDir?: string;
}

interface BulkSecretsResponse {
  created: number;
  updated: number;
}

// Parse .env file content into key-value pairs
function parseEnvFile(content: string): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Find the first = sign
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const name = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (name) {
      secrets.push({ name, value });
    }
  }

  return secrets;
}

export const SecretBulk = ({ file = '.env', projectDir }: SecretBulkProps) => {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<BulkSecretsResponse | null>(null);

  const { execute, loading, error } = useApiPost<BulkSecretsResponse>('/secrets/bulk', {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  useEffect(() => {
    const bulkUploadSecrets = async () => {
      try {
        // Resolve the file path - use projectDir, env var, or cwd
        const basePath = projectDir || process.env.POSITRONIC_CONFIG_DIR || process.cwd();
        const filePath = path.resolve(basePath, file);

        if (!fs.existsSync(filePath)) {
          setValidationError(
            `No .env file found at ${filePath}\n\n` +
            'To use this command, create a .env file in your project root with your secrets:\n' +
            '  ANTHROPIC_API_KEY=sk-ant-...\n' +
            '  DATABASE_URL=postgres://...\n' +
            '  REDIS_URL=redis://...'
          );
          return;
        }

        // Read and parse the env file
        const content = fs.readFileSync(filePath, 'utf-8');
        const secrets = parseEnvFile(content);

        if (secrets.length === 0) {
          setValidationError(
            `No secrets found in ${filePath}\n\n` +
            'Make sure your .env file contains key=value pairs:\n' +
            '  ANTHROPIC_API_KEY=sk-ant-...\n' +
            '  DATABASE_URL=postgres://...'
          );
          return;
        }

        // Send to API
        const body = JSON.stringify({ secrets });
        const response = await execute(body);
        setResult(response);
        setCompleted(true);
      } catch (err) {
        // Error is already handled by useApiPost
      }
    };

    bulkUploadSecrets();
  }, []);

  if (validationError) {
    return (
      <Box flexDirection="column">
        <Text color="red">{validationError}</Text>
      </Box>
    );
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Uploading secrets from {file}...</Text>
      </Box>
    );
  }

  if (completed && result) {
    const total = result.created + result.updated;

    return (
      <Box flexDirection="column">
        <Text color="green">Secrets uploaded successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Total:</Text> {total}
          </Text>
          <Text>
            <Text bold>Created:</Text> {result.created}
          </Text>
          <Text>
            <Text bold>Updated:</Text> {result.updated}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Use "px secret list" to view all secrets
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
};
