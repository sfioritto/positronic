import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
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
  const [selectedOption, setSelectedOption] = useState<'cancel' | 'delete'>('cancel');
  const { exit } = useApp();

  const { data: resourcesData, loading: listLoading, error: listError } = useApiGet<ResourcesResponse>('/resources');
  const { execute: deleteResources, loading: deleteLoading, error: deleteError } = useApiDelete('resources');

  useInput((input, key) => {
    if (!confirmed && !deleted && resourcesData && resourcesData.count > 0) {
      if (key.upArrow || key.downArrow) {
        setSelectedOption(prev => prev === 'cancel' ? 'delete' : 'cancel');
      } else if (key.return) {
        if (selectedOption === 'delete') {
          setConfirmed(true);
        } else {
          exit();
        }
      } else if (key.escape || (key.ctrl && input === 'c')) {
        exit();
      }
    }
  });

  useEffect(() => {
    if (confirmed && !deleteLoading && !deleteError && !deleted) {
      deleteResources('/resources')
        .then(() => {
          setDeleted(true);
        })
    }
  }, [confirmed, deleteLoading, deleteError, deleted, deleteResources]);

  useEffect(() => {
    if (deleted) {
      // Exit after showing success message for a moment
      const timer = setTimeout(() => {
        exit();
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [deleted, exit]);

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
        <Box marginTop={1} flexDirection="column">
          <Text>Use arrow keys to select, Enter to confirm:</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={selectedOption === 'cancel' ? 'green' : undefined}>
              {selectedOption === 'cancel' ? '▶ ' : '  '}Cancel (keep resources)
            </Text>
            <Text color={selectedOption === 'delete' ? 'red' : undefined}>
              {selectedOption === 'delete' ? '▶ ' : '  '}Delete all resources
            </Text>
          </Box>
        </Box>
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