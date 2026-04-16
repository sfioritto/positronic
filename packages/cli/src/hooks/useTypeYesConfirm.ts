import { useState, useEffect, useRef } from 'react';
import { useStdin, useApp } from 'ink';

/**
 * Hook for raw-mode stdin "type 'yes' to confirm" flows.
 *
 * Returns:
 *   confirmed — true when the user typed "yes" and pressed Enter (or force=true)
 *   input     — the characters typed so far (for display)
 *
 * When the user presses Enter with anything other than "yes", or presses
 * Ctrl+C, the Ink app is exited. Backspace is handled correctly.
 *
 * While the prompt is active (not yet confirmed), raw mode is enabled on
 * stdin and cleaned up on unmount or when confirmation is resolved.
 */
export function useTypeYesConfirm(force: boolean) {
  const [confirmed, setConfirmed] = useState(force);
  const [input, setInput] = useState('');
  const inputRef = useRef('');
  const { stdin, setRawMode } = useStdin();
  const { exit } = useApp();

  useEffect(() => {
    if (stdin && !confirmed) {
      setRawMode(true);

      const handleData = (data: Buffer) => {
        const chars = data.toString();

        for (const char of chars) {
          if (char === '\r' || char === '\n') {
            if (inputRef.current.toLowerCase() === 'yes') {
              setConfirmed(true);
            } else {
              exit();
            }
            return;
          } else if (char === '\u0003') {
            // Ctrl+C
            exit();
            return;
          } else if (char === '\u007F' || char === '\b') {
            // Backspace
            inputRef.current = inputRef.current.slice(0, -1);
            setInput(inputRef.current);
          } else {
            inputRef.current = inputRef.current + char;
            setInput(inputRef.current);
          }
        }
      };

      stdin.on('data', handleData);

      return () => {
        stdin.off('data', handleData);
        setRawMode(false);
      };
    }
  }, [stdin, setRawMode, confirmed, exit]);

  return { confirmed, input };
}
