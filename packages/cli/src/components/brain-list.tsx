import React from 'react';
import { Text, Box } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface Brain {
  filename: string;
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

// Helper to pad text to column width
const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

// Helper to wrap text to multiple lines
const wrapText = (text: string, maxWidth: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [''];
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

  // Sort brains alphabetically by title
  const sortedBrains = [...data.brains].sort((a, b) => a.title.localeCompare(b.title));

  // Define column widths
  const columns = {
    title: { header: 'Brain', width: 25 },
    description: { header: 'Description', width: 70 },
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
          <Text bold color="cyan">{padRight(columns.title.header, columns.title.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{columns.description.header}</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedBrains.map((brain) => {
          const descriptionLines = wrapText(brain.description, columns.description.width);
          return (
            <Box key={brain.filename} flexDirection="column" marginBottom={descriptionLines.length > 1 ? 1 : 0}>
              <Box>
                <Text>{padRight(brain.title.length > columns.title.width ? brain.title.substring(0, columns.title.width - 3) + '...' : brain.title, columns.title.width)}</Text>
                <Text>  </Text>
                <Text dimColor>{descriptionLines[0]}</Text>
              </Box>
              {descriptionLines.slice(1).map((line, index) => (
                <Box key={index}>
                  <Text>{' '.repeat(columns.title.width)}</Text>
                  <Text>  </Text>
                  <Text dimColor>{line}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};