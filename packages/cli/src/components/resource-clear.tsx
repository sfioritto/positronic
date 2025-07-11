import React, { useState, useEffect } from 'react';
import { Box, Text, useStdin, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet, useApiDelete } from '../hooks/useApi.js';

interface ResourcesResponse {
  resources: Array<{
    key: string;
    type: string;
    path?: string;
    size: number;
    lastModified: string;
  }>;
  truncated: boolean;
  count: number;
}

export const ResourceClear = () => {
  const [confirmed, setConfirmed] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [input, setInput] = useState('');
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const { exit } = useApp();

  const { data: resourcesData, loading: listLoading, error: listError } = useApiGet<ResourcesResponse>('/resources');
  const { execute: deleteResources, loading: deleteLoading, error: deleteError } = useApiDelete('resources');

  useEffect(() => {
    if (stdin && isRawModeSupported && !confirmed && !deleted && resourcesData && resourcesData.count > 0) {
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
  }, [stdin, setRawMode, isRawModeSupported, confirmed, deleted, input, exit, resourcesData]);

  useEffect(() => {
    if (confirmed && !deleteLoading && !deleteError && !deleted) {
      deleteResources('/resources')
        .then(() => {
          setDeleted(true);
        })
    }
  }, [confirmed, deleteLoading, deleteError, deleted, deleteResources]);

  if (listError) {
    return <ErrorComponent error={listError} />;
  }

  if (deleteError) {
    return <ErrorComponent error={deleteError} />;
  }

  if (listLoading) {
    return (
      <Box>
        <Text>📋 Loading resources...</Text>
      </Box>
    );
  }

  if (resourcesData && resourcesData.count === 0) {
    return (
      <Box>
        <Text>No resources to delete.</Text>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column">
        <Text bold color="red">🚨 DANGER: This will permanently delete ALL resources!</Text>
        <Box marginTop={1} marginBottom={1} paddingLeft={2} flexDirection="column">
          <Text>This action will delete {resourcesData?.count || 0} resource(s).</Text>
          <Text dimColor>This cannot be undone.</Text>
        </Box>
        {isRawModeSupported ? (
          <Text>Type "yes" to confirm deletion: {input}</Text>
        ) : (
          <Text dimColor>Interactive mode not available in test environment</Text>
        )}
      </Box>
    );
  }

  if (deleteLoading) {
    return (
      <Box>
        <Text>🗑️  Deleting all resources...</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box>
        <Text color="green">✅ Successfully deleted all resources</Text>
      </Box>
    );
  }

  return null;
};