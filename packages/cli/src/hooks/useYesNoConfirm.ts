import { useState } from 'react';
import { useInput, useApp } from 'ink';

/**
 * Hook for simple "press y/n to confirm" flows using Ink's useInput.
 *
 * Returns:
 *   confirmed — true when the user pressed "y" (or force=true)
 *
 * Pressing "n", Escape, or any key when not confirmed and not yet acting
 * exits the Ink app.
 *
 * This hook is only active (listens for input) while the prompt is pending:
 * !confirmed && !acting.
 */
export function useYesNoConfirm(force: boolean, acting: boolean) {
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
