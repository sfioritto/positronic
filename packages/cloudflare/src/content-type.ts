import { guessMimeType } from '@positronic/core';

export function guessContentType(nameOrKey: string): string {
  const mime = guessMimeType(nameOrKey);
  if (mime.startsWith('text/')) return `${mime}; charset=utf-8`;
  return mime;
}
