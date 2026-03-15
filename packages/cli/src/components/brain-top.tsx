import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout } from 'ink';
import { EventSource } from 'eventsource';
import { getApiBaseUrl, isApiLocalDevMode } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';
import { BrainTopTable, type RunningBrain } from './brain-top-table.js';

interface BrainWatchEvent {
  runningBrains: RunningBrain[];
}

interface BrainTopProps {
  brainFilter?: string;
}

export const BrainTop = ({ brainFilter }: BrainTopProps) => {
  const { write } = useStdout();
  const [runningBrains, setRunningBrains] = useState<RunningBrain[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [, setTick] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasReceivedDataRef = useRef(false);

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

  return (
    <BrainTopTable runningBrains={runningBrains} brainFilter={brainFilter} />
  );
};
