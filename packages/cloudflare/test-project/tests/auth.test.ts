/**
 * Auth middleware tests with JWT Bearer tokens
 *
 * These tests verify that the auth middleware correctly handles different JWT scenarios.
 */

import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { SignJWT, importPKCS8 } from 'jose';
import worker from '../src/index';

// Test Ed25519 key pair (must match ROOT_PUBLIC_KEY in wrangler.jsonc)
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIL3eMwOlojIBqC+IFspPM5IS63C48gIWqg3ZesihuyaX
-----END PRIVATE KEY-----`;

const TEST_PUBLIC_KEY_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'fYW1WaT583-Y_WWP7_lEmKa132Ue_RoEPcSoai-3kzk',
};

// Different key pair for testing invalid signatures
const WRONG_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEILcJaI9N6lmKP2fJOkxGTpJMvrCLdGGM6FQSvzm6eG1i
-----END PRIVATE KEY-----`;

async function createTestJwt(
  privateKeyPem: string,
  fingerprint: string,
  options: { expired?: boolean } = {}
): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, 'EdDSA');

  let builder = new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(fingerprint)
    .setIssuedAt();

  if (options.expired) {
    builder = builder.setExpirationTime(Math.floor(Date.now() / 1000) - 60);
  } else {
    builder = builder.setExpirationTime('30s');
  }

  return builder.sign(privateKey);
}

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
    it('should return 401 when no Authorization header', async () => {
      const request = new Request('http://example.com/brains', {
        method: 'GET',
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_PUBLIC_KEY_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('should return 401 with invalid token format (not Bearer)', async () => {
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Authorization': 'Basic dXNlcjpwYXNz',
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_PUBLIC_KEY_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('should return 401 for expired JWT', async () => {
      const token = await createTestJwt(TEST_PRIVATE_KEY_PEM, 'SHA256:test-fingerprint', { expired: true });

      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_PUBLIC_KEY_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Invalid or expired token');
    });

    it('should return 401 for invalid JWT signature', async () => {
      // Create a token signed with the wrong key
      const token = await createTestJwt(WRONG_PRIVATE_KEY_PEM, 'SHA256:test-fingerprint');

      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_PUBLIC_KEY_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('Invalid or expired token');
    });

    it('should return ROOT_KEY_NOT_CONFIGURED when no root key set', async () => {
      const token = await createTestJwt(TEST_PRIVATE_KEY_PEM, 'SHA256:test-fingerprint');

      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: undefined, // Explicitly unset to test missing key scenario
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(401);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('ROOT_KEY_NOT_CONFIGURED');
    });

    it('should allow valid JWT with matching ROOT_PUBLIC_KEY', async () => {
      const token = await createTestJwt(TEST_PRIVATE_KEY_PEM, 'SHA256:test-fingerprint');

      // Use a protected endpoint (not /status which bypasses auth)
      const request = new Request('http://example.com/brains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const testEnv = {
        ...env,
        NODE_ENV: 'production',
        ROOT_PUBLIC_KEY: JSON.stringify(TEST_PUBLIC_KEY_JWK),
      };

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      // Should pass auth and return 200 (brains list)
      expect(response.status).toBe(200);
    });
  });
});
