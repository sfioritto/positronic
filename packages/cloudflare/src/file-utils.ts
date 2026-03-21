import type { FileHandle } from '@positronic/core';

export function isFileHandle(value: unknown): value is FileHandle {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    'url' in value &&
    'read' in value &&
    typeof (value as any).read === 'function'
  );
}
