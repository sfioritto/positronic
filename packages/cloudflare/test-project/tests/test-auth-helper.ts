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

/**
 * Create a JWT with a custom fingerprint (sub claim).
 * Used to authenticate as a specific user whose key has this fingerprint.
 */
async function createJwtWithFingerprint(fingerprint: string): Promise<string> {
  const privateKey = await importPKCS8(TEST_PRIVATE_KEY_PEM, 'EdDSA');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(fingerprint)
    .setIssuedAt()
    .setExpirationTime('30s')
    .sign(privateKey);
}

/**
 * Create an authenticated fetch wrapper that authenticates as a specific user.
 *
 * Uses the root-authenticated fetch to:
 * 1. Create a user via POST /users
 * 2. Register the test public key with a unique fingerprint for that user
 * 3. Return a fetch wrapper that signs JWTs with that user's fingerprint
 *
 * The auth middleware will find the fingerprint in AuthDO, verify the JWT
 * with the stored public key (same test key), and set auth.userName.
 */
export async function createUserFetch(
  baseFetch: (request: Request) => Promise<Response>,
  rootFetch: (request: Request) => Promise<Response>,
  userName: string
): Promise<{ fetch: (request: Request) => Promise<Response>; userName: string }> {
  // 1. Create the user
  const createUserResponse = await rootFetch(
    new Request('http://example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: userName }),
    })
  );

  if (createUserResponse.status !== 201) {
    const error = await createUserResponse.text();
    throw new Error(`Failed to create user '${userName}': ${error}`);
  }

  // 2. Register the test public key with a unique fingerprint for this user
  const userFingerprint = `SHA256:user-${userName}`;
  const addKeyResponse = await rootFetch(
    new Request(`http://example.com/users/${userName}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jwk: TEST_PUBLIC_KEY_JWK,
        fingerprint: userFingerprint,
      }),
    })
  );

  if (addKeyResponse.status !== 201) {
    const error = await addKeyResponse.text();
    throw new Error(`Failed to add key for user '${userName}': ${error}`);
  }

  // 3. Create a fetch wrapper that authenticates as this user
  const userFetch = async (request: Request): Promise<Response> => {
    const token = await createJwtWithFingerprint(userFingerprint);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const body = request.body ? await request.clone().arrayBuffer() : null;

    const authRequest = new Request(request.url, {
      method: request.method,
      headers,
      body,
    });

    return baseFetch(authRequest);
  };

  return { fetch: userFetch, userName };
}
