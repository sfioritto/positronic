import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout } from 'ink';
import { EventSource } from 'eventsource';
import { STATUS } from '@positronic/core';
import { getApiBaseUrl, isApiLocalDevMode } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

interface RunningBrain {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: string;
  options?: any;
  error?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface BrainWatchEvent {
  runningBrains: RunningBrain[];
}

interface BrainTopProps {
  brainFilter?: string;
}

// Helper to format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hr ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
};

// Helper to format live duration
const formatDuration = (startedAt: number): string => {
  const durationMs = Date.now() - startedAt;
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

// Helper to get status color
const getStatusColor = (status: string): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return 'green';
    case STATUS.ERROR:
      return 'red';
    case STATUS.RUNNING:
      return 'yellow';
    case STATUS.CANCELLED:
      return 'gray';
    default:
      return 'white';
  }
};

// Helper to pad text to column width
const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

// Helper to truncate text
const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

export const BrainTop = ({ brainFilter }: BrainTopProps) => {
  const { write } = useStdout();
  const [runningBrains, setRunningBrains] = useState<RunningBrain[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [tick, setTick] = useState<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasReceivedDataRef = useRef<boolean>(false);

  // Enter alternate screen buffer on mount, exit on unmount
  // Skip in test environment to avoid interfering with test output capture
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Enter alternate screen buffer and clear
    write('\x1B[?1049h\x1B[2J\x1B[H');

    return () => {
      // Exit alternate screen buffer
      write('\x1B[?1049l');
    };
  }, [write]);

  // Update tick every second to refresh duration display
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Connect to EventSource for live updates
  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/brains/watch`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    setIsConnected(false);
    setError(null);

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as BrainWatchEvent;
        setRunningBrains(data.runningBrains || []);
        hasReceivedDataRef.current = true;
      } catch (e: any) {
        setError(new Error(`Error parsing event data: ${e.message}`));
      }
    };

    es.onerror = () => {
      // Only show error if we haven't received any data yet
      // (nock closes connection after sending data, triggering reconnect error)
      if (!hasReceivedDataRef.current) {
        const errorMessage = isApiLocalDevMode()
          ? 'Error connecting to the local development server. Is it running? Start it with "positronic server" or "px s".'
          : 'Connection failed. Please check your network connection and verify the project URL is correct.';
        setError(new Error(errorMessage));
        setIsConnected(false);
      }
      es.close();
    };

    return () => {
      es.close();
    };
  }, []);

  // Filter brains client-side
  const filteredBrains = brainFilter
    ? runningBrains.filter((b) =>
        b.brainTitle.toLowerCase().includes(brainFilter.toLowerCase())
      )
    : runningBrains;

  // Define column widths
  // Run ID is 36 chars (UUID format), keep it full for copy/paste
  const columns = {
    brain: { header: 'Brain', width: 25 },
    runId: { header: 'Run ID', width: 36 },
    status: { header: 'Status', width: 10 },
    started: { header: 'Started', width: 12 },
    duration: { header: 'Duration', width: 10 },
  };

  if (error) {
    return (
      <ErrorComponent
        error={{
          title: 'Connection Error',
          message: error.message,
          details: error.stack,
        }}
      />
    );
  }

  if (!isConnected) {
    return (
      <Box>
        <Text>Connecting to watch service...</Text>
      </Box>
    );
  }

  if (filteredBrains.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          No running brains{brainFilter ? ` matching "${brainFilter}"` : ''}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Run a brain with "px run {'<brain-name>'}" to see it here
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Running brains ({filteredBrains.length})
        {brainFilter ? ` matching "${brainFilter}"` : ''}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">
            {padRight(columns.brain.header, columns.brain.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.runId.header, columns.runId.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.status.header, columns.status.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.started.header, columns.started.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.duration.header, columns.duration.width)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(97)}</Text>
        </Box>

        {/* Data rows */}
        {filteredBrains.map((brain) => {
          const duration = brain.startedAt
            ? formatDuration(brain.startedAt)
            : 'N/A';
          const started = brain.startedAt
            ? formatRelativeTime(brain.startedAt)
            : formatRelativeTime(brain.createdAt);

          return (
            <Box key={brain.brainRunId}>
              <Text>
                {padRight(
                  truncate(brain.brainTitle, columns.brain.width),
                  columns.brain.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(brain.brainRunId, columns.runId.width)}
              </Text>
              <Text> </Text>
              <Text color={getStatusColor(brain.status)}>
                {padRight(brain.status, columns.status.width)}
              </Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(started, columns.started.width)}
              </Text>
              <Text> </Text>
              <Text>{padRight(duration, columns.duration.width)}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Footer with refresh hint */}
      <Box marginTop={1}>
        <Text dimColor>Updates automatically. Press Ctrl+C to exit.</Text>
      </Box>
    </Box>
  );
};
