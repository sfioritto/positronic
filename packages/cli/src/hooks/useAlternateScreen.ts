import { useEffect } from 'react';
import { useStdout } from 'ink';

export function useAlternateScreen(enabled = true) {
  const { write } = useStdout();

  useEffect(() => {
    if (process.env.NODE_ENV === 'test' || !enabled) {
      return;
    }

    write('\x1B[?1049h\x1B[2J\x1B[H');

    return () => {
      write('\x1B[?1049l');
    };
  }, [write, enabled]);
}
