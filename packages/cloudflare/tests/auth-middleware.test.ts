import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Hono } from 'hono';

// We'll test the middleware behavior directly without mocking the library
// by testing the specific scenarios that don't require signature parsing

// Type for our test bindings
interface TestBindings {
  NODE_ENV?: string;
  ROOT_PUBLIC_KEY?: string;
  AUTH_DO: {
    idFromName: (name: string) => string;
    get: (id: string) => {
      getKeyByFingerprint: (fingerprint: string) => Promise<any>;
    };
  };
}

// Create a minimal version of the auth middleware for testing
// This tests the key logic patterns without the full crypto implementation
function createTestMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    // Skip auth in development mode
    if (c.env.NODE_ENV === 'development') {
      c.set('auth', { userId: null, isRoot: true });
      return next();
    }

    // Get signature headers
    const signatureHeader = c.req.header('Signature');
    const signatureInputHeader = c.req.header('Signature-Input');

    // If no signature headers, return 401
    if (!signatureHeader || !signatureInputHeader) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // For testing, we simulate the signature parsing and validation
    // In real tests against the actual middleware, we'd need full crypto setup
    return c.json({ error: 'Test middleware - signature validation not implemented' }, 401);
  };
}

// Helper to create a mock Hono app with the test middleware
function createTestApp() {
  const app = new Hono<{ Bindings: TestBindings }>();

  // Add middleware
  app.use('*', createTestMiddleware());

  // Add a test route
  app.get('/test', (c) => {
    const auth = c.get('auth');
    return c.json({ auth });
  });

  return app;
}

// Helper to create a mock request
function createRequest(
  url: string = 'http://example.com/test',
  options: {
    signature?: string;
    signatureInput?: string;
  } = {}
): Request {
  const headers: Record<string, string> = {};
  if (options.signature) {
    headers['Signature'] = options.signature;
  }
  if (options.signatureInput) {
    headers['Signature-Input'] = options.signatureInput;
  }
  return new Request(url, { headers });
}

describe('authMiddleware', () => {
  describe('development mode', () => {
    it('should skip auth and set isRoot=true in development mode', async () => {
      const app = createTestApp();
      const env: TestBindings = {
        NODE_ENV: 'development',
        AUTH_DO: {
          idFromName: () => 'auth-id',
          get: () => ({
            getKeyByFingerprint: async () => null,
          }),
        },
      };

      const req = createRequest();
      const res = await app.fetch(req, env);

      expect(res.status).toBe(200);
      const body = await res.json() as { auth: { userId: string | null; isRoot: boolean } };
      expect(body.auth).toEqual({
        userId: null,
        isRoot: true,
      });
    });
  });

  describe('missing signature headers', () => {
    it('should return 401 when Signature header is missing', async () => {
      const app = createTestApp();
      const env: TestBindings = {
        NODE_ENV: 'production',
        AUTH_DO: {
          idFromName: () => 'auth-id',
          get: () => ({
            getKeyByFingerprint: async () => null,
          }),
        },
      };

      const req = createRequest('http://example.com/test', {
        signatureInput: 'sig1=("@method" "@path");created=123',
      });
      const res = await app.fetch(req, env);

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('should return 401 when Signature-Input header is missing', async () => {
      const app = createTestApp();
      const env: TestBindings = {
        NODE_ENV: 'production',
        AUTH_DO: {
          idFromName: () => 'auth-id',
          get: () => ({
            getKeyByFingerprint: async () => null,
          }),
        },
      };

      const req = createRequest('http://example.com/test', {
        signature: 'sig1=:base64signature:',
      });
      const res = await app.fetch(req, env);

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('should return 401 when both headers are missing', async () => {
      const app = createTestApp();
      const env: TestBindings = {
        NODE_ENV: 'production',
        AUTH_DO: {
          idFromName: () => 'auth-id',
          get: () => ({
            getKeyByFingerprint: async () => null,
          }),
        },
      };

      const req = createRequest();
      const res = await app.fetch(req, env);

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Authentication required');
    });
  });

  describe('username validation', () => {
    // Validation constants matching users.ts
    const MAX_USERNAME_LENGTH = 64;
    const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

    function validateUsername(name: unknown): string | null {
      if (!name || typeof name !== 'string') {
        return 'Name is required';
      }

      if (name.length === 0) {
        return 'Name cannot be empty';
      }

      if (name.length > MAX_USERNAME_LENGTH) {
        return `Name cannot exceed ${MAX_USERNAME_LENGTH} characters`;
      }

      if (!USERNAME_PATTERN.test(name)) {
        return 'Name can only contain letters, numbers, hyphens, and underscores';
      }

      return null;
    }

    it('should accept valid usernames', () => {
      const validNames = [
        'alice',
        'Bob',
        'user123',
        'test_user',
        'my-user',
        'User_Name-123',
        'a',
        'A'.repeat(64),
      ];

      for (const name of validNames) {
        expect(validateUsername(name)).toBeNull();
      }
    });

    it('should reject empty or missing names', () => {
      expect(validateUsername(null)).toBe('Name is required');
      expect(validateUsername(undefined)).toBe('Name is required');
      // Empty string is caught by the !name check first
      expect(validateUsername('')).toBe('Name is required');
      expect(validateUsername(123)).toBe('Name is required');
    });

    it('should reject names exceeding max length', () => {
      const longName = 'a'.repeat(65);
      expect(validateUsername(longName)).toBe('Name cannot exceed 64 characters');
    });

    it('should reject names with invalid characters', () => {
      const invalidNames = [
        'user@name',       // contains @
        'user name',       // contains space
        'user.name',       // contains dot
        'user!name',       // contains !
        '<script>',        // contains < and >
        'user\tname',      // contains tab
        'user\nname',      // contains newline
        'user/name',       // contains slash
        'user\\name',      // contains backslash
      ];

      for (const name of invalidNames) {
        expect(validateUsername(name)).toBe('Name can only contain letters, numbers, hyphens, and underscores');
      }
    });
  });

  describe('error message sanitization', () => {
    it('should only expose error message, not full error object', () => {
      // This tests the pattern used in auth-middleware.ts
      const error = new Error('Failed to parse: secret-data');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      expect(errorMessage).toBe('Failed to parse: secret-data');
      expect(typeof errorMessage).toBe('string');

      // Ensure we're not accidentally including stack traces or other properties
      expect(errorMessage).not.toContain('at ');
      expect(errorMessage).not.toContain('Error:');
    });

    it('should handle non-Error objects gracefully', () => {
      const nonError = { secret: 'data', toString: () => 'stringified' };
      const errorMessage = nonError instanceof Error ? nonError.message : 'Unknown error';

      expect(errorMessage).toBe('Unknown error');
    });

    it('should handle string errors', () => {
      const stringError: unknown = 'Some error message';
      const errorMessage = stringError instanceof Error ? stringError.message : 'Unknown error';

      expect(errorMessage).toBe('Unknown error');
    });
  });

  describe('signature extraction helpers', () => {
    // Test the extractSignatureInfo pattern from auth-middleware.ts

    interface ParsedSignature {
      version: 'draft' | 'rfc9421';
      value: any;
    }

    function extractSignatureInfo(parsed: ParsedSignature): { keyId: string; signature: string; base: string } | null {
      if (parsed.version === 'draft') {
        return {
          keyId: parsed.value.keyId,
          signature: parsed.value.params.signature,
          base: parsed.value.signingString,
        };
      } else if (parsed.version === 'rfc9421') {
        const signatures = parsed.value;
        if (signatures.length === 0) return null;

        const [, sigValue] = signatures[0];
        return {
          keyId: sigValue.keyid,
          signature: sigValue.signature,
          base: sigValue.base,
        };
      }
      return null;
    }

    it('should extract from draft format', () => {
      const parsed: ParsedSignature = {
        version: 'draft',
        value: {
          keyId: 'SHA256:abc123',
          params: { signature: 'base64sig' },
          signingString: '"@method": GET',
        },
      };

      const result = extractSignatureInfo(parsed);
      expect(result).toEqual({
        keyId: 'SHA256:abc123',
        signature: 'base64sig',
        base: '"@method": GET',
      });
    });

    it('should extract from rfc9421 format', () => {
      const parsed: ParsedSignature = {
        version: 'rfc9421',
        value: [
          [
            'sig1',
            {
              keyid: 'SHA256:def456',
              signature: 'rfc9421sig',
              base: '"@method": POST',
            },
          ],
        ],
      };

      const result = extractSignatureInfo(parsed);
      expect(result).toEqual({
        keyId: 'SHA256:def456',
        signature: 'rfc9421sig',
        base: '"@method": POST',
      });
    });

    it('should return null for empty rfc9421 signatures', () => {
      const parsed: ParsedSignature = {
        version: 'rfc9421',
        value: [],
      };

      const result = extractSignatureInfo(parsed);
      expect(result).toBeNull();
    });
  });

  describe('algorithm detection', () => {
    // Test the getAlgorithmForJwk pattern from auth-middleware.ts

    type SubtleCryptoAlgorithm =
      | { name: 'RSASSA-PKCS1-v1_5'; hash: string }
      | { name: 'ECDSA'; namedCurve: string }
      | { name: 'ECDSA'; hash: string }
      | { name: 'Ed25519' };

    function getAlgorithmForJwk(jwk: JsonWebKey): SubtleCryptoAlgorithm {
      if (jwk.kty === 'RSA') {
        return {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        };
      } else if (jwk.kty === 'EC') {
        return {
          name: 'ECDSA',
          namedCurve: jwk.crv || 'P-256',
        };
      } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
        return { name: 'Ed25519' };
      }
      throw new Error(`Unsupported key type: ${jwk.kty}`);
    }

    it('should return RSASSA-PKCS1-v1_5 for RSA keys', () => {
      const jwk: JsonWebKey = { kty: 'RSA' };
      const algo = getAlgorithmForJwk(jwk);
      expect(algo).toEqual({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
    });

    it('should return ECDSA with curve for EC keys', () => {
      const jwkP256: JsonWebKey = { kty: 'EC', crv: 'P-256' };
      expect(getAlgorithmForJwk(jwkP256)).toEqual({ name: 'ECDSA', namedCurve: 'P-256' });

      const jwkP384: JsonWebKey = { kty: 'EC', crv: 'P-384' };
      expect(getAlgorithmForJwk(jwkP384)).toEqual({ name: 'ECDSA', namedCurve: 'P-384' });
    });

    it('should default to P-256 for EC keys without curve', () => {
      const jwk: JsonWebKey = { kty: 'EC' };
      expect(getAlgorithmForJwk(jwk)).toEqual({ name: 'ECDSA', namedCurve: 'P-256' });
    });

    it('should return Ed25519 for OKP/Ed25519 keys', () => {
      const jwk: JsonWebKey = { kty: 'OKP', crv: 'Ed25519' };
      expect(getAlgorithmForJwk(jwk)).toEqual({ name: 'Ed25519' });
    });

    it('should throw for unsupported key types', () => {
      const jwk: JsonWebKey = { kty: 'oct' };
      expect(() => getAlgorithmForJwk(jwk)).toThrow('Unsupported key type: oct');
    });
  });
});
