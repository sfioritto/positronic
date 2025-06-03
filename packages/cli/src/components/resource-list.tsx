import React from 'react';
import { Box, Text } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { ResourceEntry } from '@positronic/core';

interface ApiResourceEntry extends ResourceEntry {
  size: number;
  lastModified: string;
}

interface ResourcesResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

export const ResourceList = () => {
  const { data, loading, error } = useApiGet<ResourcesResponse>('/resources');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return <Text>Loading resources...</Text>;
  }

  if (!data || data.resources.length === 0) {
    return <Text>No resources found in the project.</Text>;
  }

  const { resources, truncated } = data;

  // Group resources by type
  const textResources = resources.filter(r => r.type === 'text');
  const binaryResources = resources.filter(r => r.type === 'binary');

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>
        Found {resources.length} resource{resources.length === 1 ? '' : 's'}:
      </Text>

      {textResources.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>📄 Text Resources:</Text>
          {textResources.map((resource) => (
            <Box key={resource.key} paddingLeft={2}>
              <Text>- {resource.key} ({formatSize(resource.size)})</Text>
            </Box>
          ))}
        </Box>
      )}

      {binaryResources.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>📦 Binary Resources:</Text>
          {binaryResources.map((resource) => (
            <Box key={resource.key} paddingLeft={2}>
              <Text>- {resource.key} ({formatSize(resource.size)})</Text>
            </Box>
          ))}
        </Box>
      )}

      {truncated && (
        <Box marginTop={1}>
          <Text color="yellow">⚠️  Results truncated. More resources exist than shown.</Text>
        </Box>
      )}
    </Box>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}