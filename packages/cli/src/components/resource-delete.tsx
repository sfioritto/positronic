import React, { useState, useEffect } from 'react';
import { Box, Text, useStdin, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete } from '../hooks/useApi.js';

interface ResourceDeleteProps {
  resourceKey: string;
  resourcePath: string;
}

export const ResourceDelete = ({ resourceKey, resourcePath }: ResourceDeleteProps) => {
  const [confirmed, setConfirmed] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [input, setInput] = useState('');
  const { stdin, setRawMode } = useStdin();
  const { exit } = useApp();

  const { execute: deleteResource, loading, error } = useApiDelete();

  useEffect(() => {
    if (stdin && !confirmed && !deleted) {
      setRawMode(true);

      const handleData = (data: Buffer) => {
        const char = data.toString();

        if (char === '\r' || char === '\n') {
          if (input.toLowerCase() === 'yes') {
            setConfirmed(true);
          } else {
            exit();
          }
        } else if (char === '\u0003') { // Ctrl+C
          exit();
        } else if (char === '\u007F' || char === '\b') { // Backspace
          setInput(prev => prev.slice(0, -1));
        } else {
          setInput(prev => prev + char);
        }
      };

      stdin.on('data', handleData);

      return () => {
        stdin.off('data', handleData);
        setRawMode(false);
      };
    }
  }, [stdin, setRawMode, confirmed, deleted, input, exit]);

  useEffect(() => {
    if (confirmed && !loading && !error && !deleted) {
      // URL encode the key for the API endpoint
      const encodedKey = encodeURIComponent(resourceKey);
      deleteResource(`/resources/${encodedKey}`).then(() => {
        setDeleted(true);
      });
    }
  }, [confirmed, loading, error, deleted, deleteResource, resourceKey]);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">⚠️  Warning: This will permanently delete the following resource:</Text>
        <Box marginTop={1} marginBottom={1} paddingLeft={2}>
          <Text>{resourcePath}</Text>
        </Box>
        <Text>Type "yes" to confirm deletion: {input}</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box>
        <Text>🗑️  Deleting {resourcePath}...</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box>
        <Text color="green">✅ Successfully deleted: {resourcePath}</Text>
      </Box>
    );
  }

  return null;
};