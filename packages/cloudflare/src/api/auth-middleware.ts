import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './types.js';
import type { AuthDO } from '../auth-do.js';

export interface AuthContext {
  userId: string | null;
  isRoot: boolean;
}

// JWK type for SubtleCrypto
interface JWK {
  kty: string;
  crv?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

// Extend the Hono context to include auth info
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Parse the Signature-Input header to extract the keyid
 * Format example: sig1=("@method" "@path" "@authority" "content-type");created=1234567890;keyid="SHA256:abc123"
 */
function parseKeyIdFromSignatureInput(signatureInput: string): string | null {
  // Match keyid="..." pattern
  const keyIdMatch = signatureInput.match(/keyid="([^"]+)"/);
  if (keyIdMatch) {
    return keyIdMatch[1];
  }
  return null;
}

/**
 * Parse the Signature header to extract the signature value
 * Format example: sig1=:base64encodedSignature=:
 */
function parseSignatureValue(signature: string): string | null {
  // Match sig1=:...: pattern (colons delimit base64 in RFC 9421)
  const sigMatch = signature.match(/sig1=:([^:]+):/);
  if (sigMatch) {
    return sigMatch[1];
  }
  return null;
}

/**
 * Create the signature base string for verification
 * This is a simplified implementation focusing on the most common covered components
 */
function createSignatureBase(
  request: Request,
  signatureInput: string
): string {
  const url = new URL(request.url);
  const lines: string[] = [];

  // Parse which components are covered from signature-input
  const componentsMatch = signatureInput.match(/sig1=\(([^)]+)\)/);
  if (!componentsMatch) {
    throw new Error('Invalid signature-input format');
  }

  const components = componentsMatch[1].split(' ').map(c => c.replace(/"/g, ''));

  for (const component of components) {
    if (component === '@method') {
      lines.push(`"@method": ${request.method}`);
    } else if (component === '@path') {
      lines.push(`"@path": ${url.pathname}`);
    } else if (component === '@authority') {
      lines.push(`"@authority": ${url.host}`);
    } else if (component === '@target-uri') {
      lines.push(`"@target-uri": ${request.url}`);
    } else if (component.startsWith('@')) {
      // Other derived components
      continue;
    } else {
      // Regular header
      const headerValue = request.headers.get(component);
      if (headerValue) {
        lines.push(`"${component.toLowerCase()}": ${headerValue}`);
      }
    }
  }

  // Extract signature params for the signature-params line
  const paramsMatch = signatureInput.match(/sig1=\([^)]+\);(.+)/);
  const paramsString = paramsMatch ? paramsMatch[1] : '';

  lines.push(`"@signature-params": (${componentsMatch[1]});${paramsString}`);

  return lines.join('\n');
}

/**
 * Get the SubtleCrypto algorithm parameters for a JWK
 */
function getSubtleCryptoAlgorithm(jwk: JWK): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
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
  return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
}

/**
 * Verify an HTTP message signature using the provided JWK
 * Uses Web Crypto API (SubtleCrypto) for signature verification
 */
async function verifySignature(
  request: Request,
  signature: string,
  signatureInput: string,
  jwkString: string
): Promise<boolean> {
  try {
    const jwk = JSON.parse(jwkString) as JWK;
    const signatureBase = createSignatureBase(request, signatureInput);
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

    // Import the public key using Web Crypto API
    const algorithm = getSubtleCryptoAlgorithm(jwk);
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      algorithm,
      true,
      ['verify']
    );

    // Verify the signature using Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureBase);

    return await crypto.subtle.verify(
      algorithm,
      cryptoKey,
      signatureBytes,
      data
    );
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Try to parse ROOT_PUBLIC_KEY as JWK
 */
function parseRootPublicKey(rootPublicKey: string): string | null {
  try {
    const parsed = JSON.parse(rootPublicKey);
    if (parsed.kty) {
      return rootPublicKey; // Valid JWK
    }
  } catch {
    // Not valid JSON
  }

  console.warn('ROOT_PUBLIC_KEY must be in JWK format');
  return null;
}

/**
 * Authentication middleware for the Positronic API
 * Verifies HTTP message signatures (RFC 9421)
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

    // If no signature headers, check if auth is required
    if (!signatureHeader || !signatureInputHeader) {
      // No auth provided - return 401
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Extract keyid from signature-input
    const keyId = parseKeyIdFromSignatureInput(signatureInputHeader);
    if (!keyId) {
      return c.json({ error: 'Invalid signature-input: missing keyid' }, 401);
    }

    // Extract signature value
    const signatureValue = parseSignatureValue(signatureHeader);
    if (!signatureValue) {
      return c.json({ error: 'Invalid signature format' }, 401);
    }

    // Try to find the key in the auth database
    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const userKey = await authDo.getKeyByFingerprint(keyId);

    if (userKey) {
      // Verify signature with user's key
      const isValid = await verifySignature(
        c.req.raw,
        signatureValue,
        signatureInputHeader,
        userKey.jwk
      );

      if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      c.set('auth', { userId: userKey.userId, isRoot: false });
      return next();
    }

    // Key not found in database, try ROOT_PUBLIC_KEY
    // We skip fingerprint comparison and just try to verify - if it works, the key is valid
    if (c.env.ROOT_PUBLIC_KEY) {
      const rootJwk = parseRootPublicKey(c.env.ROOT_PUBLIC_KEY);
      if (rootJwk) {
        const isValid = await verifySignature(
          c.req.raw,
          signatureValue,
          signatureInputHeader,
          rootJwk
        );

        if (isValid) {
          c.set('auth', { userId: null, isRoot: true });
          return next();
        }
      }
    }

    // No matching key found
    return c.json({ error: 'Unknown key' }, 401);
  };
}
