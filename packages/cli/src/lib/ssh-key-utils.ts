import sshpk from 'sshpk';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createPublicKey, JsonWebKey } from 'crypto';

export interface SSHKeyInfo {
  jwk: JsonWebKey;
  fingerprint: string;
  algorithm: string;
}

/**
 * Convert an SSH public key file to JWK format
 * Uses sshpk for SSH parsing and Node.js crypto for PEM → JWK conversion
 */
export function convertSSHPubKeyToJWK(pubKeyPath: string): SSHKeyInfo {
  const content = readFileSync(pubKeyPath, 'utf-8').trim();
  const sshKey = sshpk.parseKey(content, 'auto');

  // Get the fingerprint using SHA256 (sshpk's job)
  const fingerprint = sshKey.fingerprint('sha256').toString();

  // Convert SSH → PEM → JWK using Node.js crypto (battle-tested)
  const pem = sshKey.toString('pem');
  const keyObject = createPublicKey(pem);
  const jwk = keyObject.export({ format: 'jwk' });

  return {
    jwk,
    fingerprint,
    algorithm: sshKey.type,
  };
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
