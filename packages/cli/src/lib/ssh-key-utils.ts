import sshpk from 'sshpk';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createPublicKey, JsonWebKey } from 'crypto';

export interface SSHKeyInfo {
  jwk: JsonWebKey;
  fingerprint: string;
  algorithm: string;
}

export interface DiscoveredKey {
  path: string;
  fingerprint: string;
  algorithm: string;
  comment?: string;
}

/**
 * Discover available SSH keys in the ~/.ssh directory
 * Scans for common key files and returns metadata about each key
 */
export function discoverSSHKeys(): DiscoveredKey[] {
  const sshDir = join(homedir(), '.ssh');

  if (!existsSync(sshDir)) {
    return [];
  }

  const discoveredKeys: DiscoveredKey[] = [];
  const processedPaths = new Set<string>();

  // Common private key filenames to look for
  const commonKeyNames = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'];

  // First, check common key names
  for (const keyName of commonKeyNames) {
    const privateKeyPath = join(sshDir, keyName);
    const publicKeyPath = join(sshDir, `${keyName}.pub`);

    if (existsSync(privateKeyPath) && !processedPaths.has(privateKeyPath)) {
      const keyInfo = tryLoadKeyInfo(privateKeyPath, publicKeyPath);
      if (keyInfo) {
        discoveredKeys.push(keyInfo);
        processedPaths.add(privateKeyPath);
      }
    }
  }

  // Also scan for any .pub files and infer private key path
  try {
    const files = readdirSync(sshDir);
    for (const file of files) {
      if (file.endsWith('.pub')) {
        const privateKeyName = file.slice(0, -4); // Remove .pub
        const privateKeyPath = join(sshDir, privateKeyName);
        const publicKeyPath = join(sshDir, file);

        if (existsSync(privateKeyPath) && !processedPaths.has(privateKeyPath)) {
          const keyInfo = tryLoadKeyInfo(privateKeyPath, publicKeyPath);
          if (keyInfo) {
            discoveredKeys.push(keyInfo);
            processedPaths.add(privateKeyPath);
          }
        }
      }
    }
  } catch {
    // If we can't read the directory, just return what we have
  }

  return discoveredKeys;
}

/**
 * Try to load key info from a private/public key pair
 */
function tryLoadKeyInfo(privateKeyPath: string, publicKeyPath: string): DiscoveredKey | null {
  try {
    // Try to read the public key to get fingerprint and algorithm
    if (existsSync(publicKeyPath)) {
      const pubContent = readFileSync(publicKeyPath, 'utf-8').trim();
      const sshKey = sshpk.parseKey(pubContent, 'auto');
      const fingerprint = sshKey.fingerprint('sha256').toString();

      // Extract comment from public key (usually the third part after algorithm and key data)
      const parts = pubContent.split(' ');
      const comment = parts.length > 2 ? parts.slice(2).join(' ') : undefined;

      return {
        path: privateKeyPath,
        fingerprint,
        algorithm: sshKey.type.toUpperCase(),
        comment,
      };
    }

    // If no public key, try to derive info from private key
    const privateContent = readFileSync(privateKeyPath, 'utf-8');
    const privateKey = sshpk.parsePrivateKey(privateContent, 'auto');
    const publicKey = privateKey.toPublic();
    const fingerprint = publicKey.fingerprint('sha256').toString();

    return {
      path: privateKeyPath,
      fingerprint,
      algorithm: privateKey.type.toUpperCase(),
    };
  } catch {
    // Key couldn't be parsed, skip it
    return null;
  }
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
 * Resolve the private key path from environment, config, or default
 * @param configuredPath - Optional configured path from ProjectConfigManager
 */
export function resolvePrivateKeyPath(configuredPath?: string | null): string {
  // Priority 1: Environment variable (highest)
  const envPath = process.env.POSITRONIC_PRIVATE_KEY;
  if (envPath) {
    if (envPath.startsWith('~')) {
      return join(homedir(), envPath.slice(1));
    }
    return envPath;
  }

  // Priority 2: Configured path from config manager
  if (configuredPath) {
    if (configuredPath.startsWith('~')) {
      return join(homedir(), configuredPath.slice(1));
    }
    return configuredPath;
  }

  // Priority 3: Default fallback
  return join(homedir(), '.ssh', 'id_rsa');
}

/**
 * Expand a path that may contain ~ to the full path
 */
export function expandPath(keyPath: string): string {
  if (keyPath.startsWith('~')) {
    return join(homedir(), keyPath.slice(1));
  }
  return keyPath;
}
