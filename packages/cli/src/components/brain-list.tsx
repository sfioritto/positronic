import React from 'react';
import { Text, Box } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface Brain {
  name: string;
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

// Helper to truncate text to fit column width
const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

// Helper to pad text to column width
const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

export const BrainList = () => {
  const { data, loading, error } = useApiGet<BrainsResponse>('/brains');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>🧠 Loading brains...</Text>
      </Box>
    );
  }

  if (!data || data.brains.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No brains found.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a brain with "px brain new &lt;name&gt;" or add .ts files to the brains/ directory
          </Text>
        </Box>
      </Box>
    );
  }

  // Sort brains alphabetically by name
  const sortedBrains = [...data.brains].sort((a, b) => a.name.localeCompare(b.name));

  // Define column widths
  const columns = {
    name: { header: 'Name', width: 25 },
    title: { header: 'Title', width: 35 },
    description: { header: 'Description', width: 50 },
  };

  // Calculate total width for separator
  const totalWidth = Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} brain{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">{padRight(columns.name.header, columns.name.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.title.header, columns.title.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.description.header, columns.description.width)}</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedBrains.map((brain) => {
          return (
            <Box key={brain.name}>
              <Text>{padRight(truncate(brain.name, columns.name.width), columns.name.width)}</Text>
              <Text>  </Text>
              <Text>{padRight(truncate(brain.title, columns.title.width), columns.title.width)}</Text>
              <Text>  </Text>
              <Text dimColor>{padRight(truncate(brain.description, columns.description.width), columns.description.width)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};