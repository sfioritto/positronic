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

export interface ModelLimits {
  rpm: number;
  tpm: number;
}

// Limits to throttle against before a provider's rate-limit headers have been
// seen (Anthropic, OpenAI) or when the provider sends none (Google). Once
// headers arrive they replace these.
//
// Values are each provider's entry paid tier as published in September 2026:
// Anthropic Start tier (RPM, input TPM), OpenAI Tier 1, Google Tier 1. Google
// stopped publishing per-model RPM/TPM in 2026 (limits are enforced per spend
// and shown only in AI Studio), so the Google rows carry the last published
// figures for each model family.
//
// Lookup is by exact id, then by the longest key the id extends with a "-"
// suffix, so dated snapshots (claude-sonnet-4-5-20250929, gpt-4o-2024-08-06),
// previews (gemini-3.1-pro-preview) and variants (gpt-5.6-sol) resolve to
// their family. Families that share limits with a shorter key (Opus 4.5-4.8,
// the gpt-5.6 variants) are listed once under that key.
const MODEL_LIMITS: Record<string, ModelLimits> = {
  // Anthropic
  'claude-fable-5': { rpm: 1_000, tpm: 500_000 },
  'claude-opus-5': { rpm: 1_000, tpm: 2_000_000 },
  'claude-opus-4': { rpm: 1_000, tpm: 2_000_000 },
  'claude-sonnet-5': { rpm: 1_000, tpm: 2_000_000 },
  'claude-sonnet-4': { rpm: 1_000, tpm: 2_000_000 },
  'claude-haiku-4-5': { rpm: 1_000, tpm: 2_000_000 },

  // OpenAI
  'gpt-6-astra': { rpm: 500, tpm: 500_000 },
  'gpt-5.6': { rpm: 500, tpm: 500_000 },
  'gpt-5.5': { rpm: 500, tpm: 500_000 },
  'gpt-5.4': { rpm: 500, tpm: 500_000 },
  'gpt-5.2': { rpm: 500, tpm: 500_000 },
  'gpt-5.1': { rpm: 500, tpm: 500_000 },
  'gpt-5': { rpm: 500, tpm: 500_000 },
  'gpt-5-mini': { rpm: 500, tpm: 500_000 },
  'gpt-5-nano': { rpm: 500, tpm: 200_000 },
  'gpt-4.1': { rpm: 500, tpm: 30_000 },
  'gpt-4.1-mini': { rpm: 500, tpm: 200_000 },
  'gpt-4o': { rpm: 500, tpm: 30_000 },
  'gpt-4o-mini': { rpm: 500, tpm: 200_000 },
  o3: { rpm: 500, tpm: 30_000 },
  'o4-mini': { rpm: 1_000, tpm: 100_000 },

  // Google
  'gemini-pro-latest': { rpm: 150, tpm: 2_000_000 },
  'gemini-flash-latest': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-flash-lite-latest': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-3.8-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-3.7-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-3.6-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-3.5-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-3.5-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-3.1-pro': { rpm: 25, tpm: 1_000_000 },
  'gemini-3.1-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-3-pro': { rpm: 25, tpm: 1_000_000 },
  'gemini-3-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-2.5-pro': { rpm: 150, tpm: 2_000_000 },
  'gemini-2.5-flash': { rpm: 1_000, tpm: 1_000_000 },
  'gemini-2.5-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
  'gemini-2.0-flash': { rpm: 2_000, tpm: 4_000_000 },
  'gemini-2.0-flash-lite': { rpm: 4_000, tpm: 4_000_000 },
};

export function getModelDefaults(modelId: string): ModelLimits | null {
  // Strip "models/" prefix used by some Google SDKs
  const normalized = modelId.startsWith('models/') ? modelId.slice(7) : modelId;

  const exact = MODEL_LIMITS[normalized];
  if (exact) return exact;

  let family: string | null = null;
  for (const key of Object.keys(MODEL_LIMITS)) {
    if (
      normalized.startsWith(`${key}-`) &&
      (family === null || key.length > family.length)
    ) {
      family = key;
    }
  }

  return family === null ? null : MODEL_LIMITS[family];
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
