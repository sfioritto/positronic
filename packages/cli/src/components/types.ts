import type { BrainEvent } from '@positronic/core';

/**
 * A stored event with its timestamp.
 * Used for displaying events in the CLI.
 */
export interface StoredEvent {
  timestamp: Date;
  event: BrainEvent;
}

export type EventsViewMode = 'auto' | 'navigating' | 'detail';
