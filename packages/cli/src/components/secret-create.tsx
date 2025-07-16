import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
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

export const SecretCreate = ({ name, value: providedValue }: SecretCreateProps) => {
  const [inputValue, setInputValue] = useState('');
  const [created, setCreated] = useState(false);
  const [secret, setSecret] = useState<CreateSecretResponse | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const { exit } = useApp();

  const { execute, loading, error } = useApiPost<CreateSecretResponse>('/secrets', {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // If value was provided via command line, create immediately
  useEffect(() => {
    if (providedValue) {
      createSecret(providedValue);
    } else {
      setIsTyping(true);
    }
  }, []);

  const createSecret = async (value: string) => {
    try {
      const body = JSON.stringify({ name, value });
      const result = await execute(body);
      setSecret(result);
      setCreated(true);
      // Exit after a short delay to show the success message
      setTimeout(() => exit(), 1000);
    } catch (err) {
      // Error is already handled by useApiPost
      setTimeout(() => exit(new Error('Failed to create secret')), 1000);
    }
  };

  useInput((input, key) => {
    if (!isTyping || created || loading) return;

    if (key.return) {
      setIsTyping(false);
      if (inputValue.trim()) {
        createSecret(inputValue);
      }
    } else if (key.backspace || key.delete) {
      setInputValue(prev => prev.slice(0, -1));
    } else if (key.escape) {
      exit();
    } else if (input && !key.ctrl && !key.meta) {
      setInputValue(prev => prev + input);
    }
  });

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box flexDirection="column">
        <Text>🔒 Creating secret...</Text>
        {providedValue && (
          <Box marginTop={1}>
            <Text color="yellow">
              ⚠️  Warning: Passing secret values via command line may expose them in shell history
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (created && secret) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Secret created successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Name:</Text> {secret.name}
          </Text>
          <Text>
            <Text bold>Created:</Text> {new Date(secret.createdAt).toLocaleString()}
          </Text>
        </Box>
        {providedValue && (
          <Box marginTop={1}>
            <Text color="yellow">
              ⚠️  Warning: Passing secret values via command line may expose them in shell history
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Use "px secret list" to view all secrets
          </Text>
        </Box>
      </Box>
    );
  }

  if (isTyping) {
    const maskedValue = '•'.repeat(inputValue.length);
    
    return (
      <Box flexDirection="column">
        <Text>🔒 Creating secret: <Text bold>{name}</Text></Text>
        <Box marginTop={1}>
          <Text>Enter value (hidden): {maskedValue}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to save, Escape to cancel</Text>
        </Box>
        {providedValue && (
          <Box marginTop={1}>
            <Text color="yellow">
              ⚠️  Warning: Passing secret values via command line may expose them in shell history
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return null;
};