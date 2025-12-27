import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';

interface Brain {
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

interface BrainResolverProps {
  identifier: string;
  children: (resolvedBrainTitle: string) => React.ReactNode;
}

type Phase = 'searching' | 'disambiguating' | 'resolved' | 'error';

/**
 * BrainResolver - A reusable component that resolves a brain identifier to a title.
 *
 * It searches for brains matching the identifier and:
 * - If 0 matches: shows an error
 * - If 1 match: renders children with the resolved brain title
 * - If multiple matches: shows a disambiguation UI
 */
export const BrainResolver = ({ identifier, children }: BrainResolverProps) => {
  const [phase, setPhase] = useState<Phase>('searching');
  const [brains, setBrains] = useState<Brain[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resolvedTitle, setResolvedTitle] = useState<string | null>(null);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);
  const { exit } = useApp();

  const getConnectionError = useCallback(() => {
    if (isApiLocalDevMode()) {
      return {
        title: 'Connection Error',
        message: 'Error connecting to the local development server.',
        details: "Please ensure the server is running ('positronic server' or 'px s').",
      };
    } else {
      return {
        title: 'Connection Error',
        message: 'Error connecting to the remote project server.',
        details: 'Please check your network connection and verify the project URL is correct.',
      };
    }
  }, []);

  // Initial search
  useEffect(() => {
    const searchBrains = async () => {
      try {
        const url = `/brains?q=${encodeURIComponent(identifier)}`;
        const response = await apiClient.fetch(url, { method: 'GET' });

        if (!response.ok) {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error searching for brains: ${response.status} ${response.statusText}`,
            details: errorText,
          });
          setPhase('error');
          return;
        }

        const data = (await response.json()) as BrainsResponse;

        if (data.count === 0) {
          setError({
            title: 'Brain Not Found',
            message: `No brains found matching '${identifier}'.`,
            details: 'Please check that:\n  1. The brain name is spelled correctly\n  2. The brain exists in your project\n  3. The brain has been properly defined and exported\n\nYou can list available brains with: positronic list',
          });
          setPhase('error');
        } else if (data.count === 1) {
          // Exactly one match - resolve it directly
          setResolvedTitle(data.brains[0].title);
          setPhase('resolved');
        } else {
          // Multiple matches - show disambiguation UI
          setBrains(data.brains);
          setPhase('disambiguating');
        }
      } catch (err: any) {
        const baseError = getConnectionError();
        setError({
          ...baseError,
          details: `${baseError.details} ${err.message}`,
        });
        setPhase('error');
      }
    };

    searchBrains();
  }, [identifier, getConnectionError]);

  // Handle keyboard input for disambiguation
  useInput((input, key) => {
    if (phase !== 'disambiguating') return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev - 1 + brains.length) % brains.length);
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % brains.length);
    } else if (key.return) {
      const selectedBrain = brains[selectedIndex];
      setResolvedTitle(selectedBrain.title);
      setPhase('resolved');
    } else if (input === 'q' || key.escape) {
      exit();
    }
  });

  // Render based on phase
  if (phase === 'searching') {
    return (
      <Box>
        <Text>Searching for brain '{identifier}'...</Text>
      </Box>
    );
  }

  if (phase === 'error' && error) {
    return <ErrorComponent error={error} />;
  }

  if (phase === 'disambiguating') {
    return (
      <Box flexDirection="column">
        <Text bold>Multiple brains match '{identifier}':</Text>
        <Box marginTop={1} flexDirection="column">
          {brains.map((brain, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Box key={brain.title} flexDirection="column" marginBottom={1}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '▶ ' : '  '}
                  <Text bold>{brain.title}</Text>
                </Text>
                <Text dimColor>
                  {'    '}
                  {brain.description}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Use arrow keys to navigate, Enter to select, q to quit
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'resolved' && resolvedTitle) {
    return <>{children(resolvedTitle)}</>;
  }

  return null;
};
