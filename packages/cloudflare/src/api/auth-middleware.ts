import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './types.js';
import type { AuthDO } from '../auth-do.js';
import { jwtVerify, decodeJwt, importJWK, type JWK } from 'jose';

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

/**
 * Get the JWT algorithm based on JWK key type
 */
function getAlgorithmForJwk(jwk: JWK): string {
  if (jwk.kty === 'RSA') {
    return 'RS256';
  } else if (jwk.kty === 'EC') {
    if (jwk.crv === 'P-256') {
      return 'ES256';
    } else if (jwk.crv === 'P-384') {
      return 'ES384';
    } else if (jwk.crv === 'P-521') {
      return 'ES512';
    }
    // Default to ES256 for unknown curves
    return 'ES256';
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    return 'EdDSA';
  }
  throw new Error(`Unsupported key type: ${jwk.kty}`);
}

/**
 * Authentication middleware for the Positronic API
 * Verifies JWT Bearer tokens
 */
export function authMiddleware(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c: Context<{ Bindings: Bindings }>, next) => {
    // Skip auth in development mode
    if (c.env.NODE_ENV === 'development') {
      c.set('auth', { userId: null, isRoot: true });
      return next();
    }

    // Get Authorization header
    const authHeader = c.req.header('Authorization');

    // If no Authorization header, return 401
    if (!authHeader) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Check for Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Decode the JWT to get the fingerprint (sub claim) without verification
    let fingerprint: string;
    try {
      const decoded = decodeJwt(token);
      if (!decoded.sub) {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
      fingerprint = decoded.sub;
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    // Try to find the key in the auth database
    let userKey = null;
    if (c.env.AUTH_DO) {
      const authDoId = c.env.AUTH_DO.idFromName('auth');
      const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;
      userKey = await authDo.getKeyByFingerprint(fingerprint);
    }

    if (userKey) {
      try {
        const jwk = JSON.parse(userKey.jwk) as JWK;
        const algorithm = getAlgorithmForJwk(jwk);
        const publicKey = await importJWK(jwk, algorithm);

        // Verify the JWT - this checks both signature and expiry
        await jwtVerify(token, publicKey, {
          algorithms: [algorithm],
        });

        c.set('auth', { userId: userKey.userId, isRoot: false });
        return next();
      } catch (error) {
        // Log error type only - avoid logging key material or token data
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('JWT verification failed:', errorMessage);
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
    }

    // Key not found in database, try ROOT_PUBLIC_KEY
    if (c.env.ROOT_PUBLIC_KEY) {
      try {
        const jwk = JSON.parse(c.env.ROOT_PUBLIC_KEY) as JWK;
        const algorithm = getAlgorithmForJwk(jwk);
        const publicKey = await importJWK(jwk, algorithm);

        // Verify the JWT - this checks both signature and expiry
        await jwtVerify(token, publicKey, {
          algorithms: [algorithm],
        });

        c.set('auth', { userId: null, isRoot: true });
        return next();
      } catch (error) {
        // Log error type only - avoid logging key material
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Root key JWT verification failed:', errorMessage);
      }
    }

    // No matching key found
    // Check if ROOT_PUBLIC_KEY is configured - if not, return specific error
    if (!c.env.ROOT_PUBLIC_KEY) {
      return c.json({ error: 'ROOT_KEY_NOT_CONFIGURED' }, 401);
    }
    return c.json({ error: 'Invalid or expired token' }, 401);
  };
}
