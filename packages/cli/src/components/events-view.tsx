import React, { useState, useEffect } from 'react';
import { Text, Box, useStdout, useInput } from 'ink';
import type { BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import { EventDetail } from './event-detail.js';
import type { StoredEvent } from '../utils/state-reconstruction.js';

export type { StoredEvent };

export type EventsViewMode = 'auto' | 'navigating' | 'detail';

interface EventsViewProps {
  events: StoredEvent[];
  totalTokens?: number;
  isActive?: boolean;
  onModeChange?: (mode: EventsViewMode) => void;
  onViewState?: (eventIndex: number) => void;
  selectedIndex?: number | null;
  onSelectedIndexChange?: (index: number | null) => void;
}

type InternalMode = 'list' | 'detail';

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
  tokens?: number;
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
        text: `Agent iteration ${event.iteration}`,
        color: 'gray',
        tokens: event.tokensThisIteration,
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
        text: `Agent completed: "${event.terminalToolName}" (${event.totalIterations} iter)`,
        color: 'green',
        tokens: event.totalTokens,
      };
    case BRAIN_EVENTS.AGENT_TOKEN_LIMIT:
      return {
        symbol: '[!]',
        text: `Token limit reached: ${event.totalTokens}/${event.maxTokens}`,
        color: 'red',
        tokens: event.totalTokens,
      };
    case BRAIN_EVENTS.AGENT_ITERATION_LIMIT:
      return {
        symbol: '[!]',
        text: `Iteration limit reached: ${event.iteration}/${event.maxIterations}`,
        color: 'red',
        tokens: event.totalTokens,
      };
    case BRAIN_EVENTS.AGENT_WEBHOOK:
      return {
        symbol: '[W]',
        text: `Agent webhook: ${event.toolName}`,
        color: 'cyan',
      };
    case BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE:
      return {
        symbol: '[~]',
        text: `Agent response (iteration ${event.iteration})`,
        color: 'gray',
      };
    default:
      return {
        symbol: '[?]',
        text: `Unknown event: ${(event as BrainEvent).type}`,
        color: 'gray',
      };
  }
}

// Calculate visible window with selection support
function calculateVisibleWindow(
  eventsLength: number,
  selectedIndex: number | null,
  maxVisible: number
): { start: number; end: number } {
  if (selectedIndex === null) {
    // Auto-scroll: show most recent
    return {
      start: Math.max(0, eventsLength - maxVisible),
      end: eventsLength,
    };
  }

  // Keep selection centered when possible
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = Math.min(eventsLength, start + maxVisible);

  // Adjust if we hit the end
  if (end === eventsLength) {
    start = Math.max(0, end - maxVisible);
  }

  return { start, end };
}

interface EventLineProps {
  stored: StoredEvent;
  isSelected: boolean;
}

const EventLine = ({ stored, isSelected }: EventLineProps) => {
  const { symbol, text, color, tokens } = formatEvent(stored.event);
  const timestamp = formatTimestamp(stored.timestamp);

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '› ' : '  '}</Text>
      <Text dimColor>{timestamp.padEnd(12)} </Text>
      <Text color={isSelected ? 'cyan' : color}>{symbol} </Text>
      <Text color={isSelected ? 'cyan' : undefined}>{text}</Text>
      {tokens !== undefined && <Text dimColor> ({tokens.toLocaleString()} tokens)</Text>}
    </Box>
  );
};

export const EventsView = ({
  events,
  totalTokens = 0,
  isActive = true,
  onModeChange,
  onViewState,
  selectedIndex: controlledSelectedIndex,
  onSelectedIndexChange,
}: EventsViewProps) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  // Reserve lines for header, footer, margins, token total
  const maxVisible = Math.max(5, terminalHeight - 8);

  const [mode, setMode] = useState<InternalMode>('list');
  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Use controlled value if provided, otherwise use internal state
  const isControlled = controlledSelectedIndex !== undefined;
  const selectedIndex = isControlled ? controlledSelectedIndex : internalSelectedIndex;

  const setSelectedIndex = (index: number | null) => {
    if (isControlled) {
      onSelectedIndexChange?.(index);
    } else {
      setInternalSelectedIndex(index);
    }
  };

  // Notify parent of mode changes
  useEffect(() => {
    if (onModeChange) {
      if (mode === 'detail') {
        onModeChange('detail');
      } else if (selectedIndex !== null) {
        onModeChange('navigating');
      } else {
        onModeChange('auto');
      }
    }
  }, [mode, selectedIndex, onModeChange]);

  // Keep selection valid when events change
  useEffect(() => {
    if (selectedIndex !== null && events.length > 0) {
      if (selectedIndex >= events.length) {
        setSelectedIndex(events.length - 1);
      }
    }
  }, [events.length, selectedIndex]);

  // Keyboard handling
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (mode === 'list') {
        if (key.upArrow || input === 'k') {
          if (selectedIndex === null) {
            // First navigation: start from last event
            if (events.length > 0) {
              setSelectedIndex(events.length - 1);
            }
          } else if (selectedIndex > 0) {
            setSelectedIndex(selectedIndex - 1);
          }
        } else if (key.downArrow || input === 'j') {
          if (selectedIndex === null) {
            if (events.length > 0) {
              setSelectedIndex(events.length - 1);
            }
          } else if (selectedIndex < events.length - 1) {
            setSelectedIndex(selectedIndex + 1);
          }
        } else if (key.return && selectedIndex !== null && events.length > 0) {
          setMode('detail');
          setScrollOffset(0);
        } else if (input === 's' && selectedIndex !== null && onViewState) {
          // View state at selected event
          onViewState(selectedIndex);
        } else if (key.escape && selectedIndex !== null) {
          // Return to auto-scroll mode
          setSelectedIndex(null);
        }
      } else if (mode === 'detail') {
        // Escape or 'b' to go back to list
        if (key.escape || input === 'b') {
          setMode('list');
        }
      }
    },
    { isActive }
  );

  // Detail view
  if (mode === 'detail' && selectedIndex !== null && events[selectedIndex]) {
    return (
      <EventDetail
        stored={events[selectedIndex]}
        scrollOffset={scrollOffset}
        onScrollChange={setScrollOffset}
        isActive={isActive}
      />
    );
  }

  // List view
  const { start, end } = calculateVisibleWindow(events.length, selectedIndex, maxVisible);
  const visibleEvents = events.slice(start, end);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Events ({events.length} total)</Text>
        {selectedIndex !== null && <Text dimColor> • Selected: {selectedIndex + 1}</Text>}
      </Box>

      {visibleEvents.length === 0 ? (
        <Text dimColor>Waiting for events...</Text>
      ) : (
        visibleEvents.map((stored, index) => (
          <EventLine key={start + index} stored={stored} isSelected={selectedIndex === start + index} />
        ))
      )}

      {/* Token total at bottom */}
      {totalTokens > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Total tokens: </Text>
          <Text bold>{totalTokens.toLocaleString()}</Text>
        </Box>
      )}
    </Box>
  );
};
