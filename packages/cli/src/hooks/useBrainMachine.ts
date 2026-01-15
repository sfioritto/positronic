import { useMemo } from 'react';
import { useMachine } from 'react-robot';
import { createBrainMachine } from '@positronic/core';
import type { CreateMachineOptions } from '@positronic/core';

/**
 * React hook for brain execution state machine.
 * Creates a fresh machine when `key` changes.
 *
 * @param key - When this value changes, a new machine is created (like React's key prop)
 * @param options - Optional machine configuration
 * @returns [current, send] - Current state and send function from useMachine
 */
export function useBrainMachine(key?: unknown, options?: CreateMachineOptions) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const machine = useMemo(() => createBrainMachine(options), [key]);
  return useMachine(machine);
}
