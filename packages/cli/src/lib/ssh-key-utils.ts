import sshpk from 'sshpk';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

export interface SSHKeyInfo {
  jwk: object;
  fingerprint: string;
  algorithm: string;
}

/**
 * Convert an SSH public key file to JWK format
 */
export function convertSSHPubKeyToJWK(pubKeyPath: string): SSHKeyInfo {
  const content = readFileSync(pubKeyPath, 'utf-8').trim();
  const key = sshpk.parseKey(content, 'auto');

  // Get the fingerprint using SHA256
  const fingerprint = key.fingerprint('sha256').toString();

  // Convert to JWK format
  // sshpk doesn't have direct JWK export, so we need to convert manually
  const jwk = convertSshpkKeyToJwk(key);

  return {
    jwk,
    fingerprint,
    algorithm: key.type,
  };
}

/**
 * Convert an sshpk key to JWK format
 */
function convertSshpkKeyToJwk(key: sshpk.Key): object {
  const pemKey = key.toString('pem');

  // For RSA keys
  if (key.type === 'rsa') {
    const rsaKey = key as sshpk.Key & { part: Record<string, { data: Buffer }> };

    // Get the RSA components from sshpk
    const n = rsaKey.part.n?.data;
    const e = rsaKey.part.e?.data;

    if (!n || !e) {
      throw new Error('Invalid RSA key: missing n or e component');
    }

    return {
      kty: 'RSA',
      n: base64UrlEncode(n),
      e: base64UrlEncode(e),
      alg: 'RS256',
    };
  }

  // For ECDSA keys
  if (key.type === 'ecdsa') {
    const ecKey = key as sshpk.Key & { part: Record<string, { data: Buffer }>, curve: string };

    // ECDSA keys have Q (public point) which contains x and y
    const Q = ecKey.part.Q?.data;
    if (!Q) {
      throw new Error('Invalid ECDSA key: missing Q component');
    }

    // The Q component is in uncompressed form: 0x04 || x || y
    // First byte is 0x04 indicating uncompressed point
    const keySize = (Q.length - 1) / 2;
    const x = Q.slice(1, 1 + keySize);
    const y = Q.slice(1 + keySize);

    // Map sshpk curve names to JWK curve names
    const curveMap: Record<string, string> = {
      'nistp256': 'P-256',
      'nistp384': 'P-384',
      'nistp521': 'P-521',
    };

    const crv = curveMap[ecKey.curve] || ecKey.curve;

    return {
      kty: 'EC',
      crv,
      x: base64UrlEncode(x),
      y: base64UrlEncode(y),
      alg: crv === 'P-256' ? 'ES256' : crv === 'P-384' ? 'ES384' : 'ES512',
    };
  }

  // For Ed25519 keys
  if (key.type === 'ed25519') {
    const edKey = key as sshpk.Key & { part: Record<string, { data: Buffer }> };
    const A = edKey.part.A?.data;

    if (!A) {
      throw new Error('Invalid Ed25519 key: missing A component');
    }

    return {
      kty: 'OKP',
      crv: 'Ed25519',
      x: base64UrlEncode(A),
      alg: 'EdDSA',
    };
  }

  throw new Error(`Unsupported key type: ${key.type}`);
}

/**
 * Base64URL encode a buffer (no padding, URL-safe alphabet)
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Load an SSH private key from a file path or environment variable
 */
export function loadPrivateKey(pathOrEnv?: string): sshpk.PrivateKey {
  let keyPath: string;

  if (pathOrEnv) {
    // If it starts with ~ or /, treat as a path
    if (pathOrEnv.startsWith('~') || pathOrEnv.startsWith('/')) {
      keyPath = pathOrEnv.startsWith('~')
        ? join(homedir(), pathOrEnv.slice(1))
        : pathOrEnv;
    } else {
      // Otherwise, check if it's an env var or direct path
      keyPath = pathOrEnv;
    }
  } else {
    // Default to ~/.ssh/id_rsa
    keyPath = join(homedir(), '.ssh', 'id_rsa');
  }

  // Expand ~ if present
  if (keyPath.startsWith('~')) {
    keyPath = join(homedir(), keyPath.slice(1));
  }

  const content = readFileSync(keyPath, 'utf-8');
  return sshpk.parsePrivateKey(content, 'auto');
}

/**
 * Get the fingerprint of a private key (from its public component)
 */
export function getPrivateKeyFingerprint(privateKey: sshpk.PrivateKey): string {
  const publicKey = privateKey.toPublic();
  return publicKey.fingerprint('sha256').toString();
}

/**
 * Sign data with an SSH private key
 */
export function signWithPrivateKey(
  privateKey: sshpk.PrivateKey,
  data: Buffer | string
): Buffer {
  const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;
  const signer = privateKey.createSign('sha256');
  signer.update(dataBuffer);
  const signature = signer.sign();
  return signature.toBuffer('raw');
}

/**
 * Resolve the private key path from environment or default
 */
export function resolvePrivateKeyPath(): string {
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  if (envPath) {
    if (envPath.startsWith('~')) {
      return join(homedir(), envPath.slice(1));
    }
    return envPath;
  }
  return join(homedir(), '.ssh', 'id_rsa');
}
