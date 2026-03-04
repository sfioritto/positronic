import { describe, it, expect } from '@jest/globals';
import { parseRateLimitHeaders, getGoogleModelDefaults } from '../src/rate-limit-headers.js';

describe('parseRateLimitHeaders', () => {
  describe('Anthropic headers', () => {
    it('parses a full set of Anthropic rate-limit headers', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': '95',
        'anthropic-ratelimit-requests-reset': '2025-01-15T12:00:00Z',
        'anthropic-ratelimit-tokens-limit': '500000',
        'anthropic-ratelimit-tokens-remaining': '450000',
        'anthropic-ratelimit-tokens-reset': '2025-01-15T12:00:00Z',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.requestsRemaining).toBe(95);
      expect(result!.requestsResetAt).toBe(new Date('2025-01-15T12:00:00Z').getTime());
      expect(result!.tokensLimit).toBe(500000);
      expect(result!.tokensRemaining).toBe(450000);
      expect(result!.tokensResetAt).toBe(new Date('2025-01-15T12:00:00Z').getTime());
    });

    it('parses partial Anthropic headers (RPM only, TPM fields null)', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': '50',
        'anthropic-ratelimit-requests-reset': '2025-01-15T12:00:00Z',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.requestsRemaining).toBe(50);
      expect(result!.requestsResetAt).toBe(new Date('2025-01-15T12:00:00Z').getTime());
      expect(result!.tokensLimit).toBeNull();
      expect(result!.tokensRemaining).toBeNull();
      expect(result!.tokensResetAt).toBeNull();
    });
  });

  describe('OpenAI headers', () => {
    it('parses a full set of OpenAI headers with duration reset format', () => {
      const before = Date.now();
      const result = parseRateLimitHeaders({
        'x-ratelimit-limit-requests': '200',
        'x-ratelimit-remaining-requests': '180',
        'x-ratelimit-reset-requests': '6m0s',
        'x-ratelimit-limit-tokens': '1000000',
        'x-ratelimit-remaining-tokens': '900000',
        'x-ratelimit-reset-tokens': '200ms',
      });
      const after = Date.now();

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(200);
      expect(result!.requestsRemaining).toBe(180);
      // 6m0s = 360000ms from now
      expect(result!.requestsResetAt).toBeGreaterThanOrEqual(before + 360000);
      expect(result!.requestsResetAt).toBeLessThanOrEqual(after + 360000);
      expect(result!.tokensLimit).toBe(1000000);
      expect(result!.tokensRemaining).toBe(900000);
      // 200ms from now
      expect(result!.tokensResetAt).toBeGreaterThanOrEqual(before + 200);
      expect(result!.tokensResetAt).toBeLessThanOrEqual(after + 200);
    });

    it('parses duration with hours, minutes, and seconds', () => {
      const before = Date.now();
      const result = parseRateLimitHeaders({
        'x-ratelimit-limit-requests': '10',
        'x-ratelimit-remaining-requests': '5',
        'x-ratelimit-reset-requests': '1h2m3s',
      });
      const after = Date.now();

      expect(result).not.toBeNull();
      // 1h2m3s = 3723000ms
      const expectedMs = (1 * 3600 + 2 * 60 + 3) * 1000;
      expect(result!.requestsResetAt).toBeGreaterThanOrEqual(before + expectedMs);
      expect(result!.requestsResetAt).toBeLessThanOrEqual(after + expectedMs);
    });
  });

  describe('case insensitivity', () => {
    it('handles mixed-case header keys', () => {
      const result = parseRateLimitHeaders({
        'Anthropic-RateLimit-Requests-Limit': '100',
        'Anthropic-RateLimit-Requests-Remaining': '50',
        'Anthropic-RateLimit-Requests-Reset': '2025-01-15T12:00:00Z',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.requestsRemaining).toBe(50);
    });
  });

  describe('unknown/empty headers', () => {
    it('returns null for empty headers', () => {
      expect(parseRateLimitHeaders({})).toBeNull();
    });

    it('returns null for unrecognized headers', () => {
      expect(
        parseRateLimitHeaders({
          'content-type': 'application/json',
          'x-request-id': 'abc123',
        })
      ).toBeNull();
    });
  });

  describe('invalid values', () => {
    it('returns null fields for non-numeric limit values', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': 'not-a-number',
        'anthropic-ratelimit-requests-remaining': 'abc',
        'anthropic-ratelimit-requests-reset': 'invalid-date',
      });

      // The headers are recognized as Anthropic but all values fail to parse
      expect(result).toBeNull();
    });

    it('preserves valid fields when some are invalid', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': 'not-a-number',
        'anthropic-ratelimit-requests-reset': '2025-01-15T12:00:00Z',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.requestsRemaining).toBeNull();
      expect(result!.requestsResetAt).toBe(new Date('2025-01-15T12:00:00Z').getTime());
    });
  });
});

describe('getGoogleModelDefaults', () => {
  it('returns defaults for gemini-2.5-pro', () => {
    const result = getGoogleModelDefaults('gemini-2.5-pro');
    expect(result).not.toBeNull();
    expect(result!.requestsLimit).toBe(150);
    expect(result!.requestsRemaining).toBe(150);
    expect(result!.tokensLimit).toBe(2_000_000);
    expect(result!.tokensRemaining).toBe(2_000_000);
    expect(result!.requestsResetAt).toBeNull();
    expect(result!.tokensResetAt).toBeNull();
  });

  it('returns defaults for gemini-3-flash', () => {
    const result = getGoogleModelDefaults('gemini-3-flash');
    expect(result).not.toBeNull();
    expect(result!.requestsLimit).toBe(1_000);
    expect(result!.tokensLimit).toBe(1_000_000);
  });

  it('returns defaults for gemini-2.5-flash-lite', () => {
    const result = getGoogleModelDefaults('gemini-2.5-flash-lite');
    expect(result).not.toBeNull();
    expect(result!.requestsLimit).toBe(4_000);
    expect(result!.tokensLimit).toBe(4_000_000);
  });

  it('returns defaults for gemini-2.5-flash', () => {
    const result = getGoogleModelDefaults('gemini-2.5-flash');
    expect(result).not.toBeNull();
    expect(result!.requestsLimit).toBe(1_000);
    expect(result!.tokensLimit).toBe(1_000_000);
  });

  it('returns null for unknown version suffixes', () => {
    expect(getGoogleModelDefaults('gemini-2.5-pro-002')).toBeNull();
  });

  it('strips models/ prefix used by Google SDKs', () => {
    const result = getGoogleModelDefaults('models/gemini-2.5-pro');
    expect(result).not.toBeNull();
    expect(result!.requestsLimit).toBe(150);
  });

  it('returns null for unknown models', () => {
    expect(getGoogleModelDefaults('claude-sonnet-4-5-20250929')).toBeNull();
    expect(getGoogleModelDefaults('gpt-4o')).toBeNull();
    expect(getGoogleModelDefaults('unknown-model')).toBeNull();
  });

  it('returns defaults for all listed Google models', () => {
    const models = [
      'gemini-3.1-pro', 'gemini-3-pro', 'gemini-3-flash',
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
      'gemini-2-flash', 'gemini-2-flash-exp', 'gemini-2-flash-lite',
    ];

    for (const model of models) {
      const result = getGoogleModelDefaults(model);
      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBeGreaterThan(0);
      expect(result!.tokensLimit).toBeGreaterThan(0);
    }
  });
});
