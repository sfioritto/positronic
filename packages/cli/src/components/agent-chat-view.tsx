import React from 'react';
import { Text, Box, useStdout, useInput } from 'ink';
import type {
  AgentStartEvent,
  AgentRawResponseMessageEvent,
} from '@positronic/core';

interface AgentChatViewProps {
  label: string;
  agentStartEvent: AgentStartEvent;
  rawResponseEvents: AgentRawResponseMessageEvent[];
  scrollOffset: number;
  onScrollChange: (offset: number) => void;
  isActive?: boolean;
}

export const AgentChatView = ({
  label,
  agentStartEvent,
  rawResponseEvents,
  scrollOffset,
  onScrollChange,
  isActive = true,
}: AgentChatViewProps) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  // Reserve lines for header, footer, margins
  const maxLines = Math.max(5, terminalHeight - 6);

  // Build content as array of lines
  const lines: string[] = [];

  // Prompt section
  lines.push('Prompt:');
  lines.push(JSON.stringify(agentStartEvent.prompt, null, 2));
  lines.push('');

  // System section (if present)
  if (agentStartEvent.system) {
    lines.push('System:');
    lines.push(JSON.stringify(agentStartEvent.system, null, 2));
    lines.push('');
  }

  // Messages section - each event now contains a single message
  if (rawResponseEvents.length > 0) {
    lines.push('Messages:');
    lines.push('');

    let currentIteration = 0;
    for (const event of rawResponseEvents) {
      // Add iteration header when iteration changes
      if (event.iteration !== currentIteration) {
        currentIteration = event.iteration;
        lines.push(`--- Iteration ${event.iteration} ---`);
        lines.push('');
      }

      // Each event contains a single message
      const messageJson = JSON.stringify(event.message, null, 2);
      lines.push(...messageJson.split('\n'));
      lines.push('');
    }
  } else {
    lines.push('No response messages yet.');
  }

  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - maxLines);
  // Page size keeps 2 lines of context
  const pageSize = Math.max(1, maxLines - 2);

  // Handle scrolling
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.upArrow || input === 'k') {
        onScrollChange(Math.max(0, scrollOffset - 1));
      } else if (key.downArrow || input === 'j') {
        onScrollChange(Math.min(maxScroll, scrollOffset + 1));
      } else if (input === ' ' && !key.shift) {
        // Space = page down
        onScrollChange(Math.min(maxScroll, scrollOffset + pageSize));
      } else if (input === ' ' && key.shift) {
        // Shift+Space = page up
        onScrollChange(Math.max(0, scrollOffset - pageSize));
      }
    },
    { isActive }
  );

  const visibleLines = lines.slice(scrollOffset, scrollOffset + maxLines);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Agent: "{label}"
        </Text>
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
            Lines {scrollOffset + 1}-
            {Math.min(scrollOffset + maxLines, totalLines)} of {totalLines}
          </Text>
        </Box>
      )}
    </Box>
  );
};
