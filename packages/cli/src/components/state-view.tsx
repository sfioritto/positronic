import React from 'react';
import { Text, Box, useStdout, useInput } from 'ink';

type JsonObject = { [key: string]: unknown };

interface StateViewProps {
  state: JsonObject;
  title: string;  // "Current State" or "State at event #5"
  scrollOffset: number;
  onScrollChange: (offset: number) => void;
  isActive?: boolean;
}

export const StateView = ({
  state,
  title,
  scrollOffset,
  onScrollChange,
  isActive = true,
}: StateViewProps) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  // Reserve lines for header, footer, margins
  const maxLines = Math.max(5, terminalHeight - 6);

  const content = JSON.stringify(state, null, 2);
  const lines = content.split('\n');
  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - maxLines);

  // Handle scrolling
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.upArrow || input === 'k') {
        onScrollChange(Math.max(0, scrollOffset - 1));
      } else if (key.downArrow || input === 'j') {
        onScrollChange(Math.min(maxScroll, scrollOffset + 1));
      }
    },
    { isActive }
  );

  const visibleLines = lines.slice(scrollOffset, scrollOffset + maxLines);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" marginLeft={2}>
        {visibleLines.map((line, i) => (
          <Text key={scrollOffset + i}>{line}</Text>
        ))}
      </Box>

      {/* Scroll indicator */}
      {totalLines > maxLines && (
        <Box marginTop={1}>
          <Text dimColor>
            Lines {scrollOffset + 1}-{Math.min(scrollOffset + maxLines, totalLines)} of {totalLines}
          </Text>
        </Box>
      )}
    </Box>
  );
};
