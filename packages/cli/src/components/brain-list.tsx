import React, { useState } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';
import { BrainInfo } from './brain-show.js';
import { padRight } from '../lib/format.js';
import { useAlternateScreen } from '../hooks/useAlternateScreen.js';

interface Brain {
  filename: string;
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

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

type Mode = 'list' | 'detail';

export const BrainList = () => {
  const { exit } = useApp();
  const { data, loading, error } = useApiGet<BrainsResponse>('/brains');

  const [mode, setMode] = useState<Mode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useAlternateScreen();

  // Sort brains alphabetically by title
  const sortedBrains = data
    ? [...data.brains].sort((a, b) => a.title.localeCompare(b.title))
    : [];

  useInput((input, key) => {
    if (mode === 'list') {
      if ((key.upArrow || input === 'k') && sortedBrains.length > 0) {
        setSelectedIndex(
          (prev) => (prev - 1 + sortedBrains.length) % sortedBrains.length
        );
      } else if ((key.downArrow || input === 'j') && sortedBrains.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % sortedBrains.length);
      } else if (key.return && sortedBrains.length > 0) {
        setMode('detail');
      } else if (input === 'q' || key.escape) {
        exit();
      }
    } else if (mode === 'detail') {
      if (key.escape) {
        setMode('list');
      } else if (input === 'q') {
        exit();
      }
    }
  });

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
            Tip: Create a brain with "px brain new &lt;name&gt;" or add .ts
            files to the brains/ directory
          </Text>
        </Box>
      </Box>
    );
  }

  // Detail mode - show BrainInfo for the selected brain
  const selectedBrain = sortedBrains[selectedIndex];
  if (mode === 'detail' && selectedBrain) {
    return (
      <Box flexDirection="column">
        <BrainInfo brainTitle={selectedBrain.title} showSteps={true} />
        <Box marginTop={1}>
          <Text dimColor>esc back | q quit</Text>
        </Box>
      </Box>
    );
  }

  // Define column widths
  const indicatorWidth = 2;
  const columns = {
    title: { header: 'Brain', width: 25 },
    description: { header: 'Description', width: 70 },
  };

  // Calculate total width for separator (including indicator column)
  const totalWidth =
    indicatorWidth +
    Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) -
    2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} brain{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text>{' '.repeat(indicatorWidth)}</Text>
          <Text bold color="cyan">
            {padRight(columns.title.header, columns.title.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {columns.description.header}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedBrains.map((brain, index) => {
          const isSelected = index === selectedIndex;
          const descriptionLines = wrapText(
            brain.description,
            columns.description.width
          );
          return (
            <Box key={brain.filename} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                  {padRight(
                    brain.title.length > columns.title.width
                      ? brain.title.substring(0, columns.title.width - 3) +
                          '...'
                      : brain.title,
                    columns.title.width
                  )}
                </Text>
                <Text> </Text>
                <Text dimColor>{descriptionLines[0]}</Text>
              </Box>
              {descriptionLines.slice(1).map((line, lineIndex) => (
                <Box key={lineIndex}>
                  <Text>{' '.repeat(indicatorWidth)}</Text>
                  <Text>{' '.repeat(columns.title.width)}</Text>
                  <Text> </Text>
                  <Text dimColor>{line}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>j/k or up/down select | Enter show | esc/q quit</Text>
      </Box>
    </Box>
  );
};
