import React from 'react';
import { Text, Box, useStdout } from 'ink';
import type { BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';

export interface StoredEvent {
  timestamp: Date;
  event: BrainEvent;
}

interface EventsViewProps {
  events: StoredEvent[];
}

// Format relative timestamp
function formatTimestamp(timestamp: Date): string {
  const now = Date.now();
  const diff = now - timestamp.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s ago` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
}

// Truncate text to a max length
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

interface FormattedEvent {
  symbol: string;
  text: string;
  color: string;
}

// Format event for display
function formatEvent(event: BrainEvent): FormattedEvent {
  switch (event.type) {
    case BRAIN_EVENTS.START:
      return {
        symbol: '[>]',
        text: `Brain started: "${event.brainTitle}"`,
        color: 'yellow',
      };
    case BRAIN_EVENTS.RESTART:
      return {
        symbol: '[>>]',
        text: `Brain restarted: "${event.brainTitle}"`,
        color: 'yellow',
      };
    case BRAIN_EVENTS.COMPLETE:
      return {
        symbol: '[ok]',
        text: `Brain completed: "${event.brainTitle}"`,
        color: 'green',
      };
    case BRAIN_EVENTS.ERROR:
      return {
        symbol: '[!!]',
        text: `Error: ${event.error.message}`,
        color: 'red',
      };
    case BRAIN_EVENTS.CANCELLED:
      return {
        symbol: '[x]',
        text: `Brain cancelled: "${event.brainTitle}"`,
        color: 'red',
      };
    case BRAIN_EVENTS.STEP_START:
      return {
        symbol: '[.]',
        text: `Step started: "${event.stepTitle}"`,
        color: 'yellow',
      };
    case BRAIN_EVENTS.STEP_COMPLETE:
      return {
        symbol: '[+]',
        text: `Step completed: "${event.stepTitle}"`,
        color: 'green',
      };
    case BRAIN_EVENTS.STEP_RETRY:
      return {
        symbol: '[?]',
        text: `Step retry: "${event.stepTitle}" (attempt ${event.attempt})`,
        color: 'yellow',
      };
    case BRAIN_EVENTS.STEP_STATUS:
      return {
        symbol: '[-]',
        text: `Step status update (${event.steps.length} steps)`,
        color: 'gray',
      };
    case BRAIN_EVENTS.WEBHOOK:
      return {
        symbol: '[~]',
        text: `Waiting for webhook`,
        color: 'cyan',
      };
    case BRAIN_EVENTS.WEBHOOK_RESPONSE:
      return {
        symbol: '[<]',
        text: `Webhook response received`,
        color: 'cyan',
      };
    case BRAIN_EVENTS.AGENT_START:
      return {
        symbol: '[A]',
        text: `Agent started: "${event.stepTitle}"`,
        color: 'yellow',
      };
    case BRAIN_EVENTS.AGENT_ITERATION:
      return {
        symbol: '[#]',
        text: `Agent iteration ${event.iteration} (${event.tokensThisIteration} tokens, ${event.totalTokens} total)`,
        color: 'gray',
      };
    case BRAIN_EVENTS.AGENT_TOOL_CALL:
      return {
        symbol: '[T]',
        text: `Tool call: ${event.toolName}`,
        color: 'white',
      };
    case BRAIN_EVENTS.AGENT_TOOL_RESULT:
      return {
        symbol: '[R]',
        text: `Tool result: ${event.toolName}`,
        color: 'white',
      };
    case BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE:
      return {
        symbol: '[M]',
        text: `Assistant: ${truncate(event.content, 50)}`,
        color: 'white',
      };
    case BRAIN_EVENTS.AGENT_COMPLETE:
      return {
        symbol: '[A]',
        text: `Agent completed: "${event.terminalToolName}" (${event.totalIterations} iterations, ${event.totalTokens} tokens)`,
        color: 'green',
      };
    case BRAIN_EVENTS.AGENT_TOKEN_LIMIT:
      return {
        symbol: '[!]',
        text: `Token limit reached: ${event.totalTokens}/${event.maxTokens}`,
        color: 'red',
      };
    case BRAIN_EVENTS.AGENT_ITERATION_LIMIT:
      return {
        symbol: '[!]',
        text: `Iteration limit reached: ${event.iteration}/${event.maxIterations} (${event.totalTokens} tokens)`,
        color: 'red',
      };
    case BRAIN_EVENTS.AGENT_WEBHOOK:
      return {
        symbol: '[W]',
        text: `Agent webhook: ${event.toolName}`,
        color: 'cyan',
      };
    default:
      return {
        symbol: '[?]',
        text: `Unknown event: ${(event as BrainEvent).type}`,
        color: 'gray',
      };
  }
}

interface EventLineProps {
  stored: StoredEvent;
}

const EventLine = ({ stored }: EventLineProps) => {
  const { symbol, text, color } = formatEvent(stored.event);
  const timestamp = formatTimestamp(stored.timestamp);

  return (
    <Box>
      <Text dimColor>{timestamp.padEnd(12)} </Text>
      <Text color={color}>{symbol} </Text>
      <Text>{text}</Text>
    </Box>
  );
};

export const EventsView = ({ events }: EventsViewProps) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  // Reserve lines for header, footer, margins
  const maxVisible = Math.max(5, terminalHeight - 6);

  // Show most recent events at bottom (scrolling up)
  const visibleEvents = events.slice(-maxVisible);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Events ({events.length} total)</Text>
      </Box>

      {visibleEvents.length === 0 ? (
        <Text dimColor>Waiting for events...</Text>
      ) : (
        visibleEvents.map((stored, index) => (
          <EventLine key={index} stored={stored} />
        ))
      )}
    </Box>
  );
};
