import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout, useInput, useApp } from 'ink';
import { EventSource } from 'eventsource';
import { getApiBaseUrl, isApiLocalDevMode } from '../commands/helpers.js';
import { useApiDelete } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { BrainTopTable, type RunningBrain } from './brain-top-table.js';
import { Watch } from './watch.js';

interface BrainWatchEvent {
  runningBrains: RunningBrain[];
}

interface TopNavigatorProps {
  brainFilter?: string;
}

type Mode = 'list' | 'detail';

export const TopNavigator = ({ brainFilter }: TopNavigatorProps) => {
  const { write } = useStdout();
  const { exit } = useApp();

  // Navigation state
  const [mode, setMode] = useState<Mode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Data state
  const [runningBrains, setRunningBrains] = useState<RunningBrain[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [, setTick] = useState(0);

  // Kill state (for list mode)
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [isKilling, setIsKilling] = useState(false);
  const [killMessage, setKillMessage] = useState<string | null>(null);
  const { execute: killBrain, error: killError } = useApiDelete('brain');

  const eventSourceRef = useRef<EventSource | null>(null);
  const hasReceivedDataRef = useRef(false);

  // Filter brains client-side
  const filteredBrains = brainFilter
    ? runningBrains.filter((b) =>
        b.brainTitle.toLowerCase().includes(brainFilter.toLowerCase())
      )
    : runningBrains;

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

  // Update tick every second to refresh duration display (in list mode)
  useEffect(() => {
    if (mode !== 'list') return;

    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [mode]);

  // Connect to EventSource for live updates (only in list mode)
  useEffect(() => {
    if (mode !== 'list') {
      // Close existing connection when leaving list mode
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/brains/watch`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    setIsConnected(false);
    setError(null);
    hasReceivedDataRef.current = false;

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
  }, [mode]);

  // Keyboard handling
  useInput((input, key) => {
    if (mode === 'list') {
      // Handle kill confirmation
      if (confirmingKill) {
        if (input === 'y') {
          const brain = filteredBrains[selectedIndex];
          if (brain) {
            setConfirmingKill(false);
            setIsKilling(true);
            killBrain(`/brains/runs/${brain.brainRunId}`)
              .then(() => {
                setKillMessage(`Killed: ${brain.brainTitle}`);
                setTimeout(() => setKillMessage(null), 2000);
              })
              .finally(() => {
                setIsKilling(false);
              });
          }
        } else if (input === 'n' || key.escape) {
          setConfirmingKill(false);
        }
        return;
      }

      // List mode navigation (arrows and vim j/k)
      if ((key.upArrow || input === 'k') && filteredBrains.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + filteredBrains.length) % filteredBrains.length);
      } else if ((key.downArrow || input === 'j') && filteredBrains.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % filteredBrains.length);
      } else if (key.return && filteredBrains.length > 0) {
        // Drill into watch view
        const brain = filteredBrains[selectedIndex];
        if (brain) {
          setSelectedRunId(brain.brainRunId);
          setMode('detail');
        }
      } else if (input === 'x' && filteredBrains.length > 0 && !isKilling) {
        setConfirmingKill(true);
      } else if (input === 'q' || key.escape) {
        exit();
      }
    } else if (mode === 'detail') {
      // Detail mode navigation - b or escape goes back to list
      if (input === 'b' || key.escape) {
        setSelectedRunId(null);
        setMode('list');
      }
    }
  });

  // Adjust selectedIndex if brains list shrinks
  useEffect(() => {
    if (filteredBrains.length > 0 && selectedIndex >= filteredBrains.length) {
      setSelectedIndex(filteredBrains.length - 1);
    }
  }, [filteredBrains.length, selectedIndex]);

  // Error state
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

  // Detail mode - show Watch component
  if (mode === 'detail' && selectedRunId) {
    return (
      <Watch
        runId={selectedRunId}
        manageScreenBuffer={false}
        footer="e events • b back • x kill"
      />
    );
  }

  // List mode - show connecting state
  if (!isConnected) {
    return (
      <Box>
        <Text>Connecting to watch service...</Text>
      </Box>
    );
  }

  // Build footer based on state
  let listFooter = 'j/k or ↑/↓ select • Enter watch • x kill • esc quit';
  if (confirmingKill) {
    const brain = filteredBrains[selectedIndex];
    listFooter = `Kill "${brain?.brainTitle}"? (y/n)`;
  }

  // List mode - show table
  return (
    <Box flexDirection="column">
      <BrainTopTable
        runningBrains={runningBrains}
        selectedIndex={selectedIndex}
        interactive={true}
        brainFilter={brainFilter}
        footer={listFooter}
      />
      {isKilling && (
        <Box>
          <Text color="yellow">Killing brain...</Text>
        </Box>
      )}
      {killMessage && (
        <Box>
          <Text color="green">{killMessage}</Text>
        </Box>
      )}
      {killError && <ErrorComponent error={killError} />}
    </Box>
  );
};
