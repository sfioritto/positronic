/**
 * Test authentication helper for Cloudflare tests
 * Provides JWT creation utilities for authenticated requests
 */
import { SignJWT, importPKCS8 } from 'jose';

// Ed25519 test keypair (must match ROOT_PUBLIC_KEY in wrangler.jsonc)
export const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIL3eMwOlojIBqC+IFspPM5IS63C48gIWqg3ZesihuyaX
-----END PRIVATE KEY-----`;

export const TEST_PUBLIC_KEY_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'fYW1WaT583-Y_WWP7_lEmKa132Ue_RoEPcSoai-3kzk',
};

export const TEST_FINGERPRINT = 'SHA256:test-fingerprint';

/**
 * Create a test JWT for authentication
 */
export async function createTestJwt(): Promise<string> {
  const privateKey = await importPKCS8(TEST_PRIVATE_KEY_PEM, 'EdDSA');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(TEST_FINGERPRINT)
    .setIssuedAt()
    .setExpirationTime('30s')
    .sign(privateKey);
}

/**
 * Create a Request with authentication header
 */
export async function createAuthenticatedRequest(
  url: string,
  init?: RequestInit
): Promise<Request> {
  const token = await createTestJwt();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return new Request(url, {
    ...init,
    headers,
  });
}

/**
 * Add authentication to an existing Request
 * Clones the request and adds the Authorization header
 */
export async function addAuthToRequest(request: Request): Promise<Request> {
  const token = await createTestJwt();
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);

  // Clone body if present
  const body = request.body ? await request.clone().arrayBuffer() : null;

  return new Request(request.url, {
    method: request.method,
    headers,
    body,
  });
}

/**
 * Create a fetch wrapper that adds authentication to all requests
 * Useful for wrapping test fetch functions
 */
export function createAuthenticatedFetchWrapper(
  baseFetch: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const authRequest = await addAuthToRequest(request);
    return baseFetch(authRequest);
  };
}
