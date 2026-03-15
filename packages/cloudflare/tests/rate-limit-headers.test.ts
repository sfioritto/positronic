import { describe, it, expect } from '@jest/globals';
import {
  parseRateLimitHeaders,
  getGoogleModelDefaults,
} from '../src/rate-limit-headers.js';

describe('parseRateLimitHeaders', () => {
  describe('Anthropic headers', () => {
    it('parses Anthropic rate-limit headers', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-tokens-limit': '500000',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.tokensLimit).toBe(500000);
    });

    it('parses partial Anthropic headers (RPM only)', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.tokensLimit).toBeNull();
    });
  });

  describe('OpenAI headers', () => {
    it('parses OpenAI rate-limit headers', () => {
      const result = parseRateLimitHeaders({
        'x-ratelimit-limit-requests': '200',
        'x-ratelimit-limit-tokens': '1000000',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(200);
      expect(result!.tokensLimit).toBe(1000000);
    });
  });

  describe('case insensitivity', () => {
    it('handles mixed-case header keys', () => {
      const result = parseRateLimitHeaders({
        'Anthropic-RateLimit-Requests-Limit': '100',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
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
      });

      // The headers are recognized as Anthropic but all values fail to parse
      expect(result).toBeNull();
    });

    it('preserves valid fields when some are invalid', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-tokens-limit': 'not-a-number',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
      expect(result!.tokensLimit).toBeNull();
    });
  });

  describe('ignores non-limit headers from known providers', () => {
    it('still detects Anthropic provider from non-limit headers but only parses limits', () => {
      const result = parseRateLimitHeaders({
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': '95',
        'anthropic-ratelimit-requests-reset': '2025-01-15T12:00:00Z',
      });

      expect(result).not.toBeNull();
      expect(result!.requestsLimit).toBe(100);
    });
  });
});

describe('getGoogleModelDefaults', () => {
  it('returns defaults for gemini-2.5-pro', () => {
    const result = getGoogleModelDefaults('gemini-2.5-pro');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(150);
    expect(result!.tpm).toBe(2_000_000);
  });

  it('returns defaults for gemini-3-flash', () => {
    const result = getGoogleModelDefaults('gemini-3-flash');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(1_000);
    expect(result!.tpm).toBe(1_000_000);
  });

  it('returns defaults for gemini-2.5-flash-lite', () => {
    const result = getGoogleModelDefaults('gemini-2.5-flash-lite');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(4_000);
    expect(result!.tpm).toBe(4_000_000);
  });

  it('returns defaults for gemini-2.5-flash', () => {
    const result = getGoogleModelDefaults('gemini-2.5-flash');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(1_000);
    expect(result!.tpm).toBe(1_000_000);
  });

  it('returns null for unknown version suffixes', () => {
    expect(getGoogleModelDefaults('gemini-2.5-pro-002')).toBeNull();
  });

  it('strips models/ prefix used by Google SDKs', () => {
    const result = getGoogleModelDefaults('models/gemini-2.5-pro');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(150);
  });

  it('returns null for unknown models', () => {
    expect(getGoogleModelDefaults('claude-sonnet-4-5-20250929')).toBeNull();
    expect(getGoogleModelDefaults('gpt-4o')).toBeNull();
    expect(getGoogleModelDefaults('unknown-model')).toBeNull();
  });

  it('returns defaults for all listed Google models', () => {
    const models = [
      'gemini-3.1-pro',
      'gemini-3-pro',
      'gemini-3-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2-flash',
      'gemini-2-flash-exp',
      'gemini-2-flash-lite',
    ];

    for (const model of models) {
      const result = getGoogleModelDefaults(model);
      expect(result).not.toBeNull();
      expect(result!.rpm).toBeGreaterThan(0);
      expect(result!.tpm).toBeGreaterThan(0);
    }
  });
});
