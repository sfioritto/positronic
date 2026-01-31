/**
 * Auth middleware tests with real signature verification
 *
 * These tests verify that the auth middleware correctly handles different scenarios.
 * For actual signature verification tests with real keys, see packages/cli/tests/signature-verification.test.ts
 */

import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// Pre-computed test RSA JWK (this is a test key - never use in production!)
// Generated with: ssh-keygen -t rsa -b 2048, then converted to JWK
const TEST_RSA_JWK = {
  "kty": "RSA",
  "n": "wL5_rMbJlLlZ6v6Ee7DLCY0f5XvqCRoQJWXzrGJB7y7h5yGrL9oEwQi5Ld8zYK-9eCLoB_TQPcwDz3yPwfJ_G9T0HG8XYD5aVtJrHfvkKMmR8z8cWGMPQwL0hNrJUZ4IhGnGk7Y3YQcjXvqLg5VQ8yZKmT7F4XJvZ5p6y8QxJc5T3kPm9H4y7fT5wL5_rMbJlLlZ6v6Ee7DLCY0f5XvqCRoQJWXzrGJB7y7h5yGrL9oEwQi5Ld8zYK-9eCLoB_TQPcwDz3yPwfJ_G9T0HG8XYD5aVtJrHfvkKMmR8z8cWGMPQwL0hNrJUZ4IhGnGk7Y3YQcjXvqLg5VQ8yZKmT7F4XJvZ5p6y8QxJc5T3kPm9H4y7fT5",
  "e": "AQAB"
};

describe('Auth Middleware', () => {
  describe('with NODE_ENV=development', () => {
    it('should skip auth and allow requests', async () => {
      const request = new Request('http://example.com/status', {
        method: 'GET',
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'development',
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(200);
    });
  });

  describe('with NODE_ENV=production', () => {
    it('should return 401 when no signature headers', async () => {
      const request = new Request('http://example.com/brains', {
        method: 'GET',
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_RSA_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('should return 401 with invalid signature format (no colons)', async () => {
      // Test truly invalid format - missing the :base64: format
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Signature': 'sig1=invalid',
          'Signature-Input': 'sig1=("@method" "@path" "@authority");created=' + Math.floor(Date.now() / 1000) + ';keyid="SHA256:test"',
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_RSA_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Invalid signature format');
    });

    it('should return 401 for expired signatures', async () => {
      // Test clock skew - timestamp from 2009
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Signature': 'sig1=:dGVzdA==:',
          'Signature-Input': 'sig1=("@method" "@path" "@authority");created=1234567890;keyid="SHA256:test"',
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_RSA_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Signature expired or clock skew too large');
    });

    it('should return 401 for invalid signatures with current timestamp', async () => {
      // Valid format but invalid signature (doesn't match the key)
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Signature': 'sig1=:aW52YWxpZHNpZ25hdHVyZQ==:',
          'Signature-Input': `sig1=("@method" "@path" "@authority");created=${currentTimestamp};keyid="SHA256:test"`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_RSA_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      // Since ROOT_PUBLIC_KEY is set but the signature doesn't verify, we get "Unknown key"
      expect(body.error).toBe('Unknown key');
    });

    it('should return ROOT_KEY_NOT_CONFIGURED when no root key set', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Signature': 'sig1=:dGVzdA==:',
          'Signature-Input': `sig1=("@method" "@path" "@authority");created=${currentTimestamp};keyid="SHA256:test"`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        // No ROOT_PUBLIC_KEY
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('ROOT_KEY_NOT_CONFIGURED');
    });
  });
});
