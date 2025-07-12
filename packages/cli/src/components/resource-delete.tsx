import React, { useState, useEffect } from 'react';
import { Box, Text, useStdin, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete, useApiGet } from '../hooks/useApi.js';
import { generateTypes } from '../commands/helpers.js';

interface ApiResourceEntry {
  key: string;
  type: 'text' | 'binary';
  size: number;
  lastModified: string;
  local: boolean;
}

interface ResourcesResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

interface ResourceDeleteProps {
  resourceKey: string;
  resourcePath: string;
  projectRootPath?: string;
  force?: boolean;
}

export const ResourceDelete = ({ resourceKey, resourcePath, projectRootPath, force = false }: ResourceDeleteProps) => {
  const [confirmed, setConfirmed] = useState(force); // Auto-confirm if force is true
  const [deleted, setDeleted] = useState(false);
  const [input, setInput] = useState('');
  const [isLocalResource, setIsLocalResource] = useState<boolean | null>(null);
  const { stdin, setRawMode } = useStdin();
  const { exit } = useApp();

  const {
    data: resourcesData, loading: listLoading, error: listError,
  } = useApiGet<ResourcesResponse>('/resources');
  const { execute: deleteResource, loading, error } = useApiDelete('resource');

  // Check if the resource is local
  useEffect(() => {
    if (resourcesData) {
      const resource = resourcesData.resources.find(r => r.key === resourceKey);
      if (resource) {
        setIsLocalResource(resource.local);
      } else {
        setIsLocalResource(false); // Resource doesn't exist
      }
    }
  }, [resourcesData, resourceKey]);

  useEffect(() => {
    if (stdin && !confirmed && !deleted && !force) {
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
  }, [stdin, setRawMode, confirmed, deleted, input, exit, force]);

  useEffect(() => {
    if (confirmed && !loading && !error && !deleted) {
      // URL encode the key for the API endpoint
      const encodedKey = encodeURIComponent(resourceKey);
      deleteResource(`/resources/${encodedKey}`)
        .then(() => {
          setDeleted(true);

          // Generate types after successful deletion if in local dev mode
          if (projectRootPath) {
            generateTypes(projectRootPath)
              .catch((typeError) => {              // Don't fail the delete if type generation fails
                console.error('Failed to generate types:', typeError);
              });
          }
        });
    }
  }, [confirmed, loading, error, deleted, deleteResource, resourceKey, projectRootPath]);

  if (listError) {
    return <ErrorComponent error={listError} />;
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (listLoading || isLocalResource === null) {
    return (
      <Box>
        <Text>Checking resource...</Text>
      </Box>
    );
  }

  if (isLocalResource) {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>❌ Cannot Delete Local Resource</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>This resource was synced from your local filesystem.</Text>
          <Text dimColor>To remove it, delete the file locally and run 'px resources sync'.</Text>
        </Box>
      </Box>
    );
  }

  if (!confirmed && !force) {
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
      <Box flexDirection="column">
        <Text color="green">✅ Successfully deleted: {resourcePath}</Text>
      </Box>
    );
  }

  return null;
};