import { useState, useEffect, useRef } from 'react';
import { useInput, useApp, useStdin } from 'ink';

interface UseYesNoConfirmOptions {
  force: boolean;
  acting: boolean;
}

interface UseTypeYesConfirmOptions {
  force: boolean;
}

interface YesNoResult {
  confirmed: boolean;
}

interface TypeYesResult {
  confirmed: boolean;
  input: string;
}

/**
 * Confirmation hooks. A component picks one; they are separate hooks
 * rather than one hook with a mode so that each is called unconditionally.
 *
 * useYesNoConfirm — uses Ink's useInput; single-key y/n response.
 *   Returns: { confirmed }
 *   Pressing 'n', Escape, or any key when not confirmed and not acting exits the app.
 *   Only active while the prompt is pending: !confirmed && !acting.
 *
 * useTypeYesConfirm — raw-mode stdin; user types "yes" and presses Enter.
 *   Returns: { confirmed, input }
 *   Pressing Enter with anything other than "yes", or Ctrl+C, exits the app.
 *   Backspace is handled correctly.
 */
export function useYesNoConfirm({
  force,
  acting,
}: UseYesNoConfirmOptions): YesNoResult {
  const [confirmed, setConfirmed] = useState(force);
  const { exit } = useApp();

  useInput((input, key) => {
    if (!confirmed && !acting) {
      if (input.toLowerCase() === 'y') {
        setConfirmed(true);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        exit();
      }
    }
  });

  return { confirmed };
}

export function useTypeYesConfirm({
  force,
}: UseTypeYesConfirmOptions): TypeYesResult {
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
