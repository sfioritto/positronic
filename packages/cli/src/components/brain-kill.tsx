import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdin, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete } from '../hooks/useApi.js';

interface BrainKillProps {
  runId: string;
  force: boolean;
}

export const BrainKill = ({ runId, force }: BrainKillProps) => {
  const [confirmed, setConfirmed] = useState(force);
  const [killed, setKilled] = useState(false);
  const [input, setInput] = useState('');
  const { stdin, setRawMode } = useStdin();
  const { exit } = useApp();
  const isKilling = useRef(false);

  const { execute: killBrain, loading, error } = useApiDelete('brain');

  useEffect(() => {
    if (stdin && !confirmed && !killed) {
      setRawMode(true);

      const handleData = (data: Buffer) => {
        const char = data.toString();

        if (char === '\r' || char === '\n') {
          if (input.toLowerCase() === 'yes') {
            setConfirmed(true);
          } else {
            exit();
          }
        } else if (char === '\u0003') { // Ctrl+C
          exit();
        } else if (char === '\u007F' || char === '\b') { // Backspace
          setInput(prev => prev.slice(0, -1));
        } else {
          setInput(prev => prev + char);
        }
      };

      stdin.on('data', handleData);

      return () => {
        stdin.off('data', handleData);
        setRawMode(false);
      };
    }
  }, [stdin, setRawMode, confirmed, killed, exit]);

  useEffect(() => {
    if (confirmed && !killed && !isKilling.current) {
      isKilling.current = true;
      killBrain(`/brains/runs/${runId}`)
        .then(() => {
          setKilled(true);
        })
        .catch(() => {
          // Error is already handled by useApiDelete
        })
        .finally(() => {
          isKilling.current = false;
        });
    }
  }, [confirmed, killed, runId, killBrain]);

  if (error) {
    // Check if it's a 404 error
    if (error.details?.includes('404')) {
      return (
        <Box flexDirection="column">
          <Text color="red">❌ Brain run not found</Text>
          <Box marginTop={1} paddingLeft={2}>
            <Text>No brain run found with ID: {runId}</Text>
          </Box>
        </Box>
      );
    }
    // Check if it's a 409 error (conflict - brain already completed)
    if (error.details?.includes('409')) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">⚠️  Brain run is not active</Text>
          <Box marginTop={1} paddingLeft={2}>
            <Text>The brain run has already completed or was previously cancelled.</Text>
          </Box>
        </Box>
      );
    }
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>🛑 Killing brain run...</Text>
      </Box>
    );
  }

  if (killed) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Brain run killed successfully!</Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>Run ID: {runId}</Text>
        </Box>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">⚠️  Warning: This will stop the running brain</Text>
        <Box marginTop={1} marginBottom={1} paddingLeft={2} flexDirection="column">
          <Text>Run ID: {runId}</Text>
          <Text dimColor>The brain will be cancelled and cannot be resumed.</Text>
        </Box>
        <Text>Type "yes" to confirm: {input}</Text>
      </Box>
    );
  }

  return null;
};