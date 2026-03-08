export interface ParsedRateLimits {
  requestsLimit: number | null;
  tokensLimit: number | null;
}

const ANTHROPIC_PREFIX = 'anthropic-ratelimit-';
const OPENAI_PREFIX = 'x-ratelimit-';

const ANTHROPIC_KEYS: Record<string, keyof ParsedRateLimits> = {
  'requests-limit': 'requestsLimit',
  'tokens-limit': 'tokensLimit',
};

const OPENAI_KEYS: Record<string, keyof ParsedRateLimits> = {
  'limit-requests': 'requestsLimit',
  'limit-tokens': 'tokensLimit',
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
    tokensLimit: null,
  };

  let hasAnyValue = false;

  for (const [suffix, field] of Object.entries(keyMap)) {
    const headerKey = prefix + suffix;
    const value = normalized[headerKey];
    if (value === undefined) continue;

    result[field] = parseNumeric(value);

    if (result[field] !== null) {
      hasAnyValue = true;
    }
  }

  return hasAnyValue ? result : null;
}
