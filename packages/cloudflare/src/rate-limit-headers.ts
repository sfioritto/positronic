export interface ParsedRateLimits {
  requestsLimit: number | null;
  requestsRemaining: number | null;
  requestsResetAt: number | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  tokensResetAt: number | null;
}

const ANTHROPIC_PREFIX = 'anthropic-ratelimit-';
const OPENAI_PREFIX = 'x-ratelimit-';

const ANTHROPIC_KEYS: Record<string, keyof ParsedRateLimits> = {
  'requests-limit': 'requestsLimit',
  'requests-remaining': 'requestsRemaining',
  'requests-reset': 'requestsResetAt',
  'tokens-limit': 'tokensLimit',
  'tokens-remaining': 'tokensRemaining',
  'tokens-reset': 'tokensResetAt',
};

const OPENAI_KEYS: Record<string, keyof ParsedRateLimits> = {
  'limit-requests': 'requestsLimit',
  'remaining-requests': 'requestsRemaining',
  'reset-requests': 'requestsResetAt',
  'limit-tokens': 'tokensLimit',
  'remaining-tokens': 'tokensRemaining',
  'reset-tokens': 'tokensResetAt',
};

// Google Gemini doesn't return rate-limit headers, so we hardcode known limits.
const GOOGLE_MODEL_LIMITS: Record<string, { rpm: number; tpm: number }> = {
  'gemini-2.5-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-2.5-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-2.5-pro': { rpm: 150, tpm: 2_000_000 },
  'gemini-2-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-2-flash-exp': { rpm: 10, tpm: 250_000 },
  'gemini-2-flash': { rpm: 2_000, tpm: 4_000_000 },
  'gemini-3.1-pro': { rpm: 25, tpm: 1_000_000 },
  'gemini-3-pro': { rpm: 25, tpm: 1_000_000 },
  'gemini-3-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-3.1-flash-lite-preview': { rpm: 4_000, tpm: 4_000_000 },
};

export function getGoogleModelDefaults(
  modelId: string
): { rpm: number; tpm: number } | null {
  // Strip "models/" prefix used by some Google SDKs
  const normalized = modelId.startsWith('models/') ? modelId.slice(7) : modelId;

  const entry = GOOGLE_MODEL_LIMITS[normalized];
  if (!entry) return null;

  return entry;
}

function parseDurationToMs(duration: string): number | null {
  const regex = /(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?/;
  const match = duration.match(regex);
  if (!match) return null;

  const [, hours, minutes, seconds, millis] = match;
  if (!hours && !minutes && !seconds && !millis) return null;

  return (
    parseInt(hours || '0', 10) * 3600000 +
    parseInt(minutes || '0', 10) * 60000 +
    parseInt(seconds || '0', 10) * 1000 +
    parseInt(millis || '0', 10)
  );
}

function parseResetValue(value: string): number | null {
  // Try ISO 8601 date first (Anthropic format)
  const dateMs = new Date(value).getTime();
  if (!isNaN(dateMs)) return dateMs;

  // Try duration string (OpenAI format: "6m0s", "200ms", "1h2m3s")
  const durationMs = parseDurationToMs(value);
  if (durationMs !== null) return Date.now() + durationMs;

  return null;
}

function parseNumeric(value: string): number | null {
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

export function parseRateLimitHeaders(
  headers: Record<string, string>
): ParsedRateLimits | null {
  // Normalize all header keys to lowercase
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  // Detect provider by checking for known prefixes
  let keyMap: Record<string, keyof ParsedRateLimits> | null = null;
  let prefix: string | null = null;

  for (const key of Object.keys(normalized)) {
    if (key.startsWith(ANTHROPIC_PREFIX)) {
      keyMap = ANTHROPIC_KEYS;
      prefix = ANTHROPIC_PREFIX;
      break;
    }
    if (key.startsWith(OPENAI_PREFIX)) {
      keyMap = OPENAI_KEYS;
      prefix = OPENAI_PREFIX;
      break;
    }
  }

  if (!keyMap || !prefix) return null;

  const result: ParsedRateLimits = {
    requestsLimit: null,
    requestsRemaining: null,
    requestsResetAt: null,
    tokensLimit: null,
    tokensRemaining: null,
    tokensResetAt: null,
  };

  let hasAnyValue = false;

  for (const [suffix, field] of Object.entries(keyMap)) {
    const headerKey = prefix + suffix;
    const value = normalized[headerKey];
    if (value === undefined) continue;

    if (field.endsWith('ResetAt')) {
      result[field] = parseResetValue(value);
    } else {
      result[field] = parseNumeric(value);
    }

    if (result[field] !== null) {
      hasAnyValue = true;
    }
  }

  return hasAnyValue ? result : null;
}
