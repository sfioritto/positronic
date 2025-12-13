import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiPost } from '../hooks/useApi.js';

interface SecretCreateProps {
  name: string;
  value?: string;
}

interface CreateSecretResponse {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const SecretCreate = ({ name, value }: SecretCreateProps) => {
  const [created, setCreated] = useState(false);
  const [secret, setSecret] = useState<CreateSecretResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { execute, loading, error } = useApiPost<CreateSecretResponse>('/secrets', {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  useEffect(() => {
    const createSecret = async () => {
      if (!value) {
        setValidationError('Please provide a value using --value flag');
        return;
      }

      try {
        const body = JSON.stringify({ name, value });
        const result = await execute(body);
        setSecret(result);
        setCreated(true);
      } catch (err) {
        // Error is already handled by useApiPost
      }
    };

    createSecret();
  }, []);

  if (validationError) {
    return (
      <Box flexDirection="column">
        <Text color="red">{validationError}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Example: px secret create {name} --value=my-secret-value
          </Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Creating secret...</Text>
      </Box>
    );
  }

  if (created && secret) {
    return (
      <Box flexDirection="column">
        <Text color="green">Secret created successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Name:</Text> {secret.name}
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
