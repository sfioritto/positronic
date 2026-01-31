import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './types.js';
import type { AuthDO } from '../auth-do.js';

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
 * Parsed RFC 9421 signature information
 */
interface RFC9421SignatureInfo {
  label: string;
  signature: string;
  keyId: string;
  created: number;
  coveredComponents: string[];
}

/**
 * Parse RFC 9421 Signature header
 * Format: sig1=:base64signature:
 */
function parseRFC9421Signature(signatureHeader: string): Map<string, string> {
  const signatures = new Map<string, string>();
  // Match pattern: label=:base64:
  const regex = /(\w+)=:([A-Za-z0-9+/=]+):/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    signatures.set(match[1], match[2]);
  }
  return signatures;
}

/**
 * Parse RFC 9421 Signature-Input header
 * Format: sig1=("@method" "@path" "@authority");created=123;keyid="fingerprint"
 */
function parseRFC9421SignatureInput(signatureInputHeader: string): Map<string, { coveredComponents: string[]; created: number; keyId: string }> {
  const inputs = new Map<string, { coveredComponents: string[]; created: number; keyId: string }>();

  // Split by comma for multiple signatures, but be careful with quoted values
  // For simplicity, we'll handle a single signature first
  const parts = signatureInputHeader.split(/,(?=\w+=\()/);

  for (const part of parts) {
    const trimmed = part.trim();

    // Match label and components: label=("comp1" "comp2" ...)
    const labelMatch = trimmed.match(/^(\w+)=\(([^)]*)\)/);
    if (!labelMatch) continue;

    const label = labelMatch[1];
    const componentsStr = labelMatch[2];

    // Parse covered components: "@method" "@path" "@authority"
    const coveredComponents: string[] = [];
    const compRegex = /"([^"]+)"/g;
    let compMatch;
    while ((compMatch = compRegex.exec(componentsStr)) !== null) {
      coveredComponents.push(compMatch[1]);
    }

    // Parse parameters after the components
    const paramsStr = trimmed.slice(labelMatch[0].length);

    // Extract created timestamp
    const createdMatch = paramsStr.match(/;created=(\d+)/);
    const created = createdMatch ? parseInt(createdMatch[1], 10) : 0;

    // Extract keyid
    const keyIdMatch = paramsStr.match(/;keyid="([^"]+)"/);
    const keyId = keyIdMatch ? keyIdMatch[1] : '';

    inputs.set(label, { coveredComponents, created, keyId });
  }

  return inputs;
}

/**
 * Reconstruct the signature base from request and covered components
 * This must match exactly what the client signed
 */
function reconstructSignatureBase(
  method: string,
  url: URL,
  headers: Record<string, string>,
  coveredComponents: string[],
  signatureParams: string
): string {
  const lines: string[] = [];

  for (const component of coveredComponents) {
    if (component === '@method') {
      lines.push(`"@method": ${method.toUpperCase()}`);
    } else if (component === '@path') {
      lines.push(`"@path": ${url.pathname}`);
    } else if (component === '@authority') {
      lines.push(`"@authority": ${url.host}`);
    } else if (component === '@target-uri') {
      lines.push(`"@target-uri": ${url.href}`);
    } else if (component === '@scheme') {
      lines.push(`"@scheme": ${url.protocol.replace(':', '')}`);
    } else if (component === '@request-target') {
      lines.push(`"@request-target": ${url.pathname}${url.search}`);
    } else if (!component.startsWith('@')) {
      // Regular header
      const headerName = component.toLowerCase();
      const headerValue = headers[headerName] || headers[component] || '';
      lines.push(`"${headerName}": ${headerValue}`);
    }
  }

  // Add the signature-params line
  lines.push(`"@signature-params": ${signatureParams}`);

  return lines.join('\n');
}

/**
 * Parse RFC 9421 HTTP Message Signature headers and extract signature info
 */
function parseRFC9421Request(
  method: string,
  url: string,
  headers: Record<string, string>,
  signatureHeader: string,
  signatureInputHeader: string
): RFC9421SignatureInfo | null {
  // Parse the signatures
  const signatures = parseRFC9421Signature(signatureHeader);
  if (signatures.size === 0) return null;

  // Parse the signature inputs
  const inputs = parseRFC9421SignatureInput(signatureInputHeader);
  if (inputs.size === 0) return null;

  // Get the first signature (usually 'sig1')
  const firstEntry = signatures.entries().next().value;
  if (!firstEntry) return null;
  const [label, signature] = firstEntry;
  const input = inputs.get(label);
  if (!input) return null;

  return {
    label,
    signature,
    keyId: input.keyId,
    created: input.created,
    coveredComponents: input.coveredComponents,
  };
}

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

    // If no signature headers, return 401
    if (!signatureHeader || !signatureInputHeader) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Parse RFC 9421 signature
    const headers = Object.fromEntries(
      Array.from(c.req.raw.headers.entries()).map(([k, v]) => [k.toLowerCase(), v])
    );

    const sigInfo = parseRFC9421Request(
      c.req.method,
      c.req.url,
      headers,
      signatureHeader,
      signatureInputHeader
    );

    if (!sigInfo) {
      return c.json({ error: 'Invalid signature format' }, 401);
    }

    // Check clock skew (5 minutes tolerance)
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 300; // 5 minutes
    if (Math.abs(now - sigInfo.created) > clockSkew) {
      return c.json({ error: 'Signature expired or clock skew too large' }, 401);
    }

    // Reconstruct the signature params string from the input header
    // We need to extract just the params part after the label
    const paramsMatch = signatureInputHeader.match(/^\w+=(.+)$/);
    const signatureParams = paramsMatch ? paramsMatch[1] : '';

    // Reconstruct the signature base
    const parsedUrl = new URL(c.req.url);
    const base = reconstructSignatureBase(
      c.req.method,
      parsedUrl,
      headers,
      sigInfo.coveredComponents,
      signatureParams
    );

    const { keyId, signature } = sigInfo;

    // Try to find the key in the auth database
    let userKey = null;
    if (c.env.AUTH_DO) {
      const authDoId = c.env.AUTH_DO.idFromName('auth');
      const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;
      userKey = await authDo.getKeyByFingerprint(keyId);
    }

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
        // Log error type only - avoid logging key material or signature data
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Signature verification failed:', errorMessage);
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
        // Log error type only - avoid logging key material
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Root key verification failed:', errorMessage);
      }
    }

    // No matching key found
    // Check if ROOT_PUBLIC_KEY is configured - if not, return specific error
    if (!c.env.ROOT_PUBLIC_KEY) {
      return c.json({ error: 'ROOT_KEY_NOT_CONFIGURED' }, 401);
    }
    return c.json({ error: 'Unknown key' }, 401);
  };
}
