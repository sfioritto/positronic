import process from 'process';
import fetch from 'node-fetch';

/**
 * Helper function to get the next value from an AsyncIterator.
 * Throws an error if the iterator is done.
 */
export const nextStep = async <T>(
  workflowRun: AsyncIterator<T>
): Promise<T> => {
  const result = await workflowRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};

// --- CLI Integration Test Helpers ---

// Simple random port generator (user port range)
export function getRandomPort(): number {
  return Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
}

export async function waitForProcessToExit(pid: number): Promise<boolean> {
  const attempts = 4;
  const intervalMs = 50;
  let processExited = false;
  for (let i = 0; i < attempts; i++) {
    try {
      process.kill(pid, 0); // process is imported
    } catch (error) {
      processExited = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return processExited;
}

export async function waitForServerReady(url: string): Promise<boolean> {
  const attempts = 10;
  const intervalMs = 1000;
  let serverReady = false;
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url); // fetch is imported
      serverReady = true;
      break;
    } catch (error) {
      // Ignore network errors
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return serverReady;
}
