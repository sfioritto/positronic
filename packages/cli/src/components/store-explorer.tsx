import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, Box, useStdout, useInput, useApp } from 'ink';
import { apiClient } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';
import { StateView } from './state-view.js';

type Mode = 'brains' | 'keys' | 'value';

interface StoreKey {
  key: string;
  scope: 'shared' | 'user';
  userName?: string;
  size: number;
  lastModified: string;
}

interface StoreValue {
  key: string;
  value: any;
  scope: 'shared' | 'user';
  userName?: string;
}

type ErrorObject = { title: string; message: string; details?: string };

type InputKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

export const StoreExplorer = () => {
  const { write } = useStdout();
  const { exit } = useApp();

  // Navigation state
  const [mode, setMode] = useState<Mode>('brains');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Data state
  const [brains, setBrains] = useState<string[]>([]);
  const [selectedBrain, setSelectedBrain] = useState<string | null>(null);
  const [keys, setKeys] = useState<StoreKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<StoreKey | null>(null);
  const [value, setValue] = useState<StoreValue | null>(null);

  // Loading/error state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorObject | null>(null);

  // Delete confirmation state
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  // Scroll state for value view
  const [scrollOffset, setScrollOffset] = useState(0);

  // Refetch trigger
  const [fetchVersion, setFetchVersion] = useState(0);

  // Use a ref to hold the latest input handler so useInput always
  // calls through to current state, avoiding stale closure issues
  // caused by useEffect re-registration timing in ink's useInput.
  const inputHandlerRef = useRef<(input: string, key: InputKey) => void>(() => {});

  // Enter alternate screen buffer on mount, exit on unmount
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    write('\x1B[?1049h\x1B[2J\x1B[H');

    return () => {
      write('\x1B[?1049l');
    };
  }, [write]);

  // Fetch brains list
  useEffect(() => {
    if (mode !== 'brains') return;

    const fetchBrains = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.fetch('/store');
        if (!response.ok) {
          setError({
            title: 'Server Error',
            message: `Failed to load store data: ${response.status}`,
          });
          return;
        }
        const data = (await response.json()) as { brains: string[]; count: number };
        setBrains(data.brains);
      } catch (err: any) {
        setError({
          title: 'Connection Error',
          message: 'Error connecting to the server.',
          details: err.message,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchBrains();
  }, [mode, fetchVersion]);

  // Fetch keys when a brain is selected
  useEffect(() => {
    if (mode !== 'keys' || !selectedBrain) return;

    const fetchKeys = async () => {
      // Don't show loading spinner during background refetch after delete/clear
      if (!deleteMessage) {
        setLoading(true);
      }
      setError(null);
      try {
        const response = await apiClient.fetch(
          `/store/${encodeURIComponent(selectedBrain)}`
        );
        if (!response.ok) {
          setError({
            title: 'Server Error',
            message: `Failed to load keys: ${response.status}`,
          });
          return;
        }
        const data = (await response.json()) as { keys: StoreKey[]; count: number };
        setKeys(data.keys);
      } catch (err: any) {
        setError({
          title: 'Connection Error',
          message: 'Error connecting to the server.',
          details: err.message,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchKeys();
  }, [mode, selectedBrain, fetchVersion]);

  // Fetch value when a key is selected
  useEffect(() => {
    if (mode !== 'value' || !selectedBrain || !selectedKey) return;

    const fetchValue = async () => {
      setLoading(true);
      setError(null);
      try {
        const scopePath =
          selectedKey.scope === 'shared' ? 'shared' : 'user';
        const response = await apiClient.fetch(
          `/store/${encodeURIComponent(selectedBrain)}/${scopePath}/${encodeURIComponent(selectedKey.key)}`
        );
        if (!response.ok) {
          setError({
            title: 'Server Error',
            message: `Failed to load value: ${response.status}`,
          });
          return;
        }
        const data = (await response.json()) as StoreValue;
        setValue(data);
        setScrollOffset(0);
      } catch (err: any) {
        setError({
          title: 'Connection Error',
          message: 'Error connecting to the server.',
          details: err.message,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchValue();
  }, [mode, selectedBrain, selectedKey, fetchVersion]);

  // Update the ref with the latest handler on every render
  inputHandlerRef.current = (input: string, key: InputKey) => {
    // Clear delete message on any input
    if (deleteMessage) {
      setDeleteMessage(null);
    }

    if (mode === 'brains') {
      if ((key.upArrow || input === 'k') && brains.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + brains.length) % brains.length);
      } else if ((key.downArrow || input === 'j') && brains.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % brains.length);
      } else if (key.return && brains.length > 0) {
        setSelectedBrain(brains[selectedIndex]);
        setSelectedIndex(0);
        setMode('keys');
      } else if (input === 'q' || key.escape) {
        exit();
      }
    } else if (mode === 'keys') {
      // Handle delete confirmation
      if (confirmingDelete) {
        if (input === 'y') {
          const keyToDelete = keys[selectedIndex];
          if (keyToDelete && selectedBrain) {
            setConfirmingDelete(false);
            const scopePath = keyToDelete.scope === 'shared' ? 'shared' : 'user';
            apiClient
              .fetch(
                `/store/${encodeURIComponent(selectedBrain)}/${scopePath}/${encodeURIComponent(keyToDelete.key)}`,
                { method: 'DELETE' }
              )
              .then(() => {
                setDeleteMessage(`Deleted: ${keyToDelete.key}`);
                setFetchVersion((v) => v + 1);
                if (selectedIndex >= keys.length - 1) {
                  setSelectedIndex(Math.max(0, keys.length - 2));
                }
              });
          }
        } else if (input === 'n' || key.escape) {
          setConfirmingDelete(false);
        }
        return;
      }

      // Handle clear confirmation
      if (confirmingClear) {
        if (input === 'y') {
          if (selectedBrain) {
            setConfirmingClear(false);
            apiClient
              .fetch(`/store/${encodeURIComponent(selectedBrain)}`, {
                method: 'DELETE',
              })
              .then(async (res) => {
                const data = (await res.json()) as { deleted: number };
                setDeleteMessage(`Cleared ${data.deleted} keys`);
                setFetchVersion((v) => v + 1);
                setSelectedIndex(0);
              });
          }
        } else if (input === 'n' || key.escape) {
          setConfirmingClear(false);
        }
        return;
      }

      // Normal key list navigation
      if ((key.upArrow || input === 'k') && keys.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + keys.length) % keys.length);
      } else if ((key.downArrow || input === 'j') && keys.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % keys.length);
      } else if (key.return && keys.length > 0) {
        setSelectedKey(keys[selectedIndex]);
        setMode('value');
      } else if (input === 'd' && keys.length > 0) {
        setConfirmingDelete(true);
      } else if (input === 'c' && keys.length > 0) {
        setConfirmingClear(true);
      } else if (input === 'b' || key.escape) {
        setSelectedBrain(null);
        setSelectedIndex(0);
        setMode('brains');
      }
    } else if (mode === 'value') {
      // Value view - StateView handles j/k/space scrolling via isActive
      if (input === 'b' || key.escape) {
        setSelectedKey(null);
        setValue(null);
        setMode('keys');
      }
    }
  };

  // Stable callback that delegates to the ref - never changes identity,
  // so ink's useInput useEffect won't need to re-register the listener.
  const stableInputHandler = useCallback((input: string, key: InputKey) => {
    inputHandlerRef.current(input, key);
  }, []);

  // Keyboard handling - uses stable callback to avoid stale closure issues
  useInput(stableInputHandler, { isActive: mode !== 'value' });

  // Adjust selectedIndex if list shrinks
  useEffect(() => {
    const listLength =
      mode === 'brains' ? brains.length : mode === 'keys' ? keys.length : 0;
    if (listLength > 0 && selectedIndex >= listLength) {
      setSelectedIndex(listLength - 1);
    }
  }, [brains.length, keys.length, selectedIndex, mode]);

  // Error state
  if (error) {
    return <ErrorComponent error={error} />;
  }

  // Loading state - skip when there's a delete message so it stays visible
  if (loading && !deleteMessage) {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  // Value view
  if (mode === 'value' && value) {
    const stateObj =
      typeof value.value === 'object' && value.value !== null
        ? value.value
        : { value: value.value };
    const title = `${selectedBrain} / ${value.key} (${value.scope})`;

    return (
      <Box flexDirection="column">
        <StateView
          state={stateObj}
          title={title}
          scrollOffset={scrollOffset}
          onScrollChange={setScrollOffset}
          isActive={true}
        />
        <Box marginTop={1}>
          <Text dimColor>j/k scroll | space page | b back</Text>
        </Box>
      </Box>
    );
  }

  // Keys view
  if (mode === 'keys' && selectedBrain) {
    if (keys.length === 0) {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Store: {selectedBrain}
            </Text>
          </Box>
          {deleteMessage && (
            <Box>
              <Text color="green">{deleteMessage}</Text>
            </Box>
          )}
          <Text dimColor>No keys found</Text>
          <Box marginTop={1}>
            <Text dimColor>b back | q quit</Text>
          </Box>
        </Box>
      );
    }

    let footer: string;
    if (confirmingDelete) {
      const keyEntry = keys[selectedIndex];
      footer = `Delete "${keyEntry?.key}"? (y/n)`;
    } else if (confirmingClear) {
      footer = `Clear all keys for "${selectedBrain}"? (y/n)`;
    } else {
      footer = 'j/k select | Enter view | d delete | c clear all | b back';
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Store: {selectedBrain} ({keys.length} keys)
          </Text>
        </Box>

        {keys.map((entry, i) => (
          <Box key={`${entry.scope}-${entry.key}-${entry.userName || ''}`}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '> ' : '  '}
              {entry.key}
              <Text dimColor>
                {' '}
                [{entry.scope}
                {entry.userName ? `:${entry.userName}` : ''}] {entry.size}B
              </Text>
            </Text>
          </Box>
        ))}

        {deleteMessage && (
          <Box marginTop={1}>
            <Text color="green">{deleteMessage}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      </Box>
    );
  }

  // Brains view (default)
  if (brains.length === 0) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Store Explorer
          </Text>
        </Box>
        <Text dimColor>No brains with store data found</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Use .withStore() in your brain definition to persist data
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Store Explorer ({brains.length} brains)
        </Text>
      </Box>

      {brains.map((brain, i) => (
        <Box key={brain}>
          <Text color={i === selectedIndex ? 'cyan' : undefined}>
            {i === selectedIndex ? '> ' : '  '}
            {brain}
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>j/k select | Enter explore | q quit</Text>
      </Box>
    </Box>
  );
};
