import { describe, it, expect } from 'vitest';
import {
  parseRateLimitHeaders,
  getModelDefaults,
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

describe('getModelDefaults', () => {
  it('returns Anthropic Start tier limits', () => {
    const result = getModelDefaults('claude-opus-5');
    expect(result).toEqual({ rpm: 1_000, tpm: 2_000_000 });
  });

  it('returns OpenAI Tier 1 limits', () => {
    expect(getModelDefaults('gpt-5')).toEqual({ rpm: 500, tpm: 500_000 });
    expect(getModelDefaults('gpt-4o')).toEqual({ rpm: 500, tpm: 30_000 });
  });

  it('returns Google Tier 1 limits', () => {
    const result = getModelDefaults('gemini-2.5-pro');
    expect(result).toEqual({ rpm: 150, tpm: 2_000_000 });
  });

  it('resolves dated snapshots to their family', () => {
    expect(getModelDefaults('claude-sonnet-4-5-20250929')).toEqual(
      getModelDefaults('claude-sonnet-4')
    );
    expect(getModelDefaults('claude-haiku-4-5-20251001')).toEqual(
      getModelDefaults('claude-haiku-4-5')
    );
    expect(getModelDefaults('gpt-4o-2024-08-06')).toEqual(
      getModelDefaults('gpt-4o')
    );
    expect(getModelDefaults('gemini-2.5-pro-002')).toEqual(
      getModelDefaults('gemini-2.5-pro')
    );
  });

  it('resolves previews and variants to their family', () => {
    expect(getModelDefaults('gemini-3.1-pro-preview')).toEqual(
      getModelDefaults('gemini-3.1-pro')
    );
    expect(getModelDefaults('gemini-3-flash-preview')).toEqual(
      getModelDefaults('gemini-3-flash')
    );
    expect(getModelDefaults('gpt-5.6-terra')).toEqual(
      getModelDefaults('gpt-5.6')
    );
    expect(getModelDefaults('claude-opus-4-8')).toEqual(
      getModelDefaults('claude-opus-4')
    );
  });

  it('prefers the longest matching family', () => {
    // gpt-5-nano-... must not fall back to the gpt-5 row
    expect(getModelDefaults('gpt-5-nano-2025-08-07')).toEqual(
      getModelDefaults('gpt-5-nano')
    );
    expect(getModelDefaults('gpt-5-nano')!.tpm).not.toBe(
      getModelDefaults('gpt-5')!.tpm
    );
    expect(getModelDefaults('gemini-2.5-flash-lite-preview-06-17')).toEqual(
      getModelDefaults('gemini-2.5-flash-lite')
    );
  });

  it('does not match across a dot suffix', () => {
    // gpt-5.1 is its own row, not a snapshot of gpt-5
    expect(getModelDefaults('gpt-5.1')).toEqual({ rpm: 500, tpm: 500_000 });
    expect(getModelDefaults('gpt-5.3')).toBeNull();
  });

  it('knows the Google -latest aliases', () => {
    expect(getModelDefaults('gemini-flash-latest')).toEqual(
      getModelDefaults('gemini-2.5-flash')
    );
    expect(getModelDefaults('gemini-flash-lite-latest')).toEqual(
      getModelDefaults('gemini-2.5-flash-lite')
    );
    expect(getModelDefaults('gemini-pro-latest')).toEqual(
      getModelDefaults('gemini-2.5-pro')
    );
  });

  it('strips models/ prefix used by Google SDKs', () => {
    const result = getModelDefaults('models/gemini-2.5-pro');
    expect(result).not.toBeNull();
    expect(result!.rpm).toBe(150);
  });

  it('returns null for unknown models', () => {
    expect(getModelDefaults('unknown-model')).toBeNull();
    expect(getModelDefaults('gpt-3.5-turbo')).toBeNull();
    expect(getModelDefaults('claude-3-opus-20240229')).toBeNull();
  });
});
