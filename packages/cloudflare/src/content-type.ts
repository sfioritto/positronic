const CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  css: 'text/css',
  js: 'application/javascript',
  xml: 'application/xml',
  csv: 'text/csv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
};

export function guessContentType(nameOrKey: string): string {
  const ext = nameOrKey.split('.').pop()?.toLowerCase();
  return CONTENT_TYPES[ext ?? ''] ?? 'application/octet-stream';
}
