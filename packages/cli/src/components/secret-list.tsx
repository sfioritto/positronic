import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface Secret {
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface SecretsResponse {
  secrets: Secret[];
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

// Helper to format dates consistently
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

export const SecretList = () => {
  const { data, loading, error } = useApiGet<SecretsResponse>('/secrets');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Loading secrets...</Text>
      </Box>
    );
  }

  if (!data || data.secrets.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No secrets found.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a secret with "px secret create &lt;name&gt; --value=&lt;value&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Define column widths
  const columns = {
    name: { header: 'Name', width: 30 },
    updatedAt: { header: 'Updated', width: 25 },
  };

  // Calculate total width for separator
  const totalWidth = Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  // Sort secrets by name
  const sortedSecrets = [...data.secrets].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} secret{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">{padRight(columns.name.header, columns.name.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.updatedAt.header, columns.updatedAt.width)}</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedSecrets.map((secret) => (
          <Box key={secret.name}>
            <Text>{padRight(truncate(secret.name, columns.name.width), columns.name.width)}</Text>
            <Text>  </Text>
            <Text dimColor>{padRight(formatDate(secret.updatedAt), columns.updatedAt.width)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
