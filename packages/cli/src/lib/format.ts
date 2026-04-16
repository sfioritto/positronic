import { STATUS } from '@positronic/core';

/**
 * Pads text on the right with spaces to reach the target column width.
 */
export const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

/**
 * Truncates text to fit within maxWidth characters, appending '...' if needed.
 */
export const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

/**
 * Formats a date/timestamp as a locale date+time string.
 * Accepts a Unix timestamp (number), ISO string (string), or Date object.
 */
export const formatDate = (d: Date | string | number): string => {
  const date = new Date(d as string | number);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

/**
 * Formats a past timestamp as a human-readable relative time (e.g. "5 min ago").
 * Accepts a Unix timestamp in milliseconds.
 */
export const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hr ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
};

/**
 * Formats a future Date as a human-readable relative time (e.g. "5 min", "overdue").
 * Used for displaying scheduled next-run times.
 */
export const formatNextRunTime = (date: Date): string => {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return '(overdue)';
  } else if (diffMins < 1) {
    return '< 1 min';
  } else if (diffMins < 60) {
    return `${diffMins} min`;
  } else if (diffHours < 24) {
    return `${diffHours} hr`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }
};

/**
 * Formats the elapsed duration between two timestamps.
 * When endMs is omitted, uses Date.now() (for live/running durations).
 */
export const formatDuration = (startMs: number, endMs?: number): string => {
  const durationMs = (endMs ?? Date.now()) - startMs;
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

/**
 * Formats a byte count as a human-readable file size string (B, KB, MB, GB).
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Maps a brain/step status string to an Ink color name.
 */
export const getStatusColor = (status: string): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return 'green';
    case STATUS.ERROR:
      return 'red';
    case STATUS.RUNNING:
      return 'yellow';
    case STATUS.CANCELLED:
      return 'gray';
    case STATUS.PAUSED:
      return 'cyan';
    case STATUS.WAITING:
      return 'magenta';
    case STATUS.HALTED:
      return 'gray';
    case STATUS.PENDING:
      return 'gray';
    default:
      return 'white';
  }
};
