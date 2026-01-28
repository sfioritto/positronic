import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './types.js';
import type { AuthDO } from '../auth-do.js';
import {
  parseRequestSignature,
  type ParsedSignature,
} from '@misskey-dev/node-http-message-signatures';

export interface AuthContext {
  userId: string | null;
  isRoot: boolean;
}

// Extend the Hono context to include auth info
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

// Algorithm types for SubtleCrypto operations
type SubtleCryptoAlgorithm =
  | { name: 'RSASSA-PKCS1-v1_5'; hash: string }
  | { name: 'ECDSA'; namedCurve: string }
  | { name: 'ECDSA'; hash: string }
  | { name: 'Ed25519' };

/**
 * Get the algorithm parameters for SubtleCrypto based on JWK key type
 */
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

/**
 * Get the algorithm parameters for signature verification
 */
function getVerifyAlgorithm(jwk: JsonWebKey): SubtleCryptoAlgorithm {
  if (jwk.kty === 'RSA') {
    return {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    };
  } else if (jwk.kty === 'EC') {
    return {
      name: 'ECDSA',
      hash: 'SHA-256',
    };
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    return { name: 'Ed25519' };
  }
  throw new Error(`Unsupported key type: ${jwk.kty}`);
}

/**
 * Convert a JWK to a CryptoKey for signature verification
 */
async function jwkToCryptoKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString) as JsonWebKey;
  const algorithm = getAlgorithmForJwk(jwk);
  return crypto.subtle.importKey('jwk', jwk, algorithm, true, ['verify']);
}

/**
 * Verify a signature using Web Crypto API
 */
async function verifySignatureWithKey(
  signatureBase: string,
  signatureB64: string,
  cryptoKey: CryptoKey,
  jwk: JsonWebKey
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureBase);
  const signatureBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
  const algorithm = getVerifyAlgorithm(jwk);

  return crypto.subtle.verify(algorithm, cryptoKey, signatureBytes, data);
}

/**
 * Extract keyId and signature info from parsed signature
 * Handles both draft and RFC9421 formats
 */
function extractSignatureInfo(parsed: ParsedSignature): { keyId: string; signature: string; base: string } | null {
  if (parsed.version === 'draft') {
    return {
      keyId: parsed.value.keyId,
      signature: parsed.value.params.signature,
      base: parsed.value.signingString,
    };
  } else if (parsed.version === 'rfc9421') {
    // RFC9421 returns an array of [label, value] tuples
    const signatures = parsed.value;
    if (signatures.length === 0) return null;

    // Use the first signature (usually 'sig1')
    const [, sigValue] = signatures[0];
    return {
      keyId: sigValue.keyid,
      signature: sigValue.signature,
      base: sigValue.base,
    };
  }
  return null;
}

/**
 * Authentication middleware for the Positronic API
 * Verifies HTTP message signatures (RFC 9421) using @misskey-dev/node-http-message-signatures for parsing
 */
export function authMiddleware(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c: Context<{ Bindings: Bindings }>, next) => {
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

    // Parse the signature using the library
    let parsedSignature: ParsedSignature;
    try {
      // Build a request-like object for the library
      const requestForParsing = {
        method: c.req.method,
        url: c.req.url,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
      };

      parsedSignature = parseRequestSignature(requestForParsing, {
        clockSkew: {
          now: new Date(),
          forward: 300000, // 5 minutes
          delay: 300000,   // 5 minutes
        },
      });
    } catch (error) {
      console.error('Failed to parse signature:', error);
      return c.json({ error: 'Invalid signature format' }, 401);
    }

    // Extract signature info from parsed result
    const sigInfo = extractSignatureInfo(parsedSignature);
    if (!sigInfo) {
      return c.json({ error: 'No valid signature found' }, 401);
    }

    const { keyId, signature, base } = sigInfo;

    // Try to find the key in the auth database
    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const userKey = await authDo.getKeyByFingerprint(keyId);

    if (userKey) {
      try {
        const jwk = JSON.parse(userKey.jwk) as JsonWebKey;
        const cryptoKey = await jwkToCryptoKey(userKey.jwk);
        const isValid = await verifySignatureWithKey(base, signature, cryptoKey, jwk);

        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 401);
        }

        c.set('auth', { userId: userKey.userId, isRoot: false });
        return next();
      } catch (error) {
        console.error('Signature verification failed:', error);
        return c.json({ error: 'Signature verification failed' }, 401);
      }
    }

    // Key not found in database, try ROOT_PUBLIC_KEY
    if (c.env.ROOT_PUBLIC_KEY) {
      try {
        const jwk = JSON.parse(c.env.ROOT_PUBLIC_KEY) as JsonWebKey;
        const cryptoKey = await jwkToCryptoKey(c.env.ROOT_PUBLIC_KEY);
        const isValid = await verifySignatureWithKey(base, signature, cryptoKey, jwk);

        if (isValid) {
          c.set('auth', { userId: null, isRoot: true });
          return next();
        }
      } catch (error) {
        console.error('Root key verification failed:', error);
      }
    }

    // No matching key found
    return c.json({ error: 'Unknown key' }, 401);
  };
}
