import { SignJWT, importPKCS8 } from 'jose';
import { existsSync } from 'fs';
import { createPrivateKey } from 'crypto';
import {
  loadPrivateKey,
  getPrivateKeyFingerprint,
  resolvePrivateKeyPath,
} from './ssh-key-utils.js';
import type sshpk from 'sshpk';
import { ProjectConfigManager } from '../commands/project-config-manager.js';

/**
 * JWT Auth Provider for authenticating API requests
 * Uses SSH private keys to sign short-lived JWTs
 */
export class JwtAuthProvider {
  private privateKey: sshpk.PrivateKey | null = null;
  private fingerprint: string | null = null;
  private initialized = false;
  private initError: Error | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    try {
      // Get configured path from project config manager
      const configManager = new ProjectConfigManager();
      const configuredPath = configManager.getPrivateKeyPath();

      const keyPath = resolvePrivateKeyPath(configuredPath);

      if (!existsSync(keyPath)) {
        this.initError = new Error(
          `Private key not found at ${keyPath}. Run 'px auth login' to configure your SSH key, or set POSITRONIC_PRIVATE_KEY environment variable.`
        );
        return;
      }

      this.privateKey = loadPrivateKey(keyPath);
      this.fingerprint = getPrivateKeyFingerprint(this.privateKey);
      this.initialized = true;
    } catch (error) {
      this.initError =
        error instanceof Error
          ? error
          : new Error('Failed to initialize JWT auth provider');
    }
  }

  /**
   * Check if the provider is ready to create JWTs
   */
  isReady(): boolean {
    return this.initialized && this.privateKey !== null;
  }

  /**
   * Get the error that occurred during initialization, if any
   */
  getError(): Error | null {
    return this.initError;
  }

  /**
   * Get the fingerprint of the loaded private key
   */
  getFingerprint(): string | null {
    return this.fingerprint;
  }

  /**
   * Map SSH key type to JWT algorithm
   */
  private getAlgorithm(): string {
    if (!this.privateKey) {
      throw new Error('Private key not loaded');
    }

    const keyType = this.privateKey.type;

    if (keyType === 'rsa') {
      return 'RS256';
    } else if (keyType === 'ecdsa') {
      // ECDSA curve determines algorithm
      const curve = this.privateKey.curve;
      if (curve === 'nistp256') {
        return 'ES256';
      } else if (curve === 'nistp384') {
        return 'ES384';
      } else if (curve === 'nistp521') {
        return 'ES512';
      }
      // Default to ES256 for unknown curves
      return 'ES256';
    } else if (keyType === 'ed25519') {
      return 'EdDSA';
    }

    throw new Error(`Unsupported key type: ${keyType}`);
  }

  /**
   * Convert the SSH private key to PKCS8 PEM format
   * Ed25519 keys need special handling because sshpk's PKCS8 output
   * is not compatible with Node.js/OpenSSL
   */
  private getPkcs8Pem(): string {
    if (!this.privateKey) {
      throw new Error('Private key not loaded');
    }

    if (this.privateKey.type === 'ed25519') {
      // For Ed25519, sshpk's PKCS8 output includes the public key in a format
      // that Node.js/OpenSSL doesn't understand. Instead, we construct a JWK
      // from the raw key parts and let Node's crypto handle the conversion.
      // sshpk stores Ed25519 key data in 'k' (seed) and 'A' (public) parts
      const parts = this.privateKey.part as unknown as Record<
        string,
        { data: Buffer }
      >;
      const seed = parts.k.data;
      const publicKey = parts.A.data;

      // Construct JWK and let Node's crypto convert to PKCS8
      const jwk = {
        kty: 'OKP',
        crv: 'Ed25519',
        d: seed.toString('base64url'),
        x: publicKey.toString('base64url'),
      };

      const keyObj = createPrivateKey({ key: jwk, format: 'jwk' });
      return keyObj.export({ type: 'pkcs8', format: 'pem' }) as string;
    }

    // For RSA and ECDSA, sshpk's PKCS8 output works fine
    return this.privateKey.toString('pkcs8');
  }

  /**
   * Create a short-lived JWT for authentication
   */
  async createToken(): Promise<string> {
    if (!this.privateKey || !this.fingerprint) {
      throw new Error('JWT auth provider not initialized');
    }

    const algorithm = this.getAlgorithm();

    // Convert SSH private key to PKCS8 PEM format
    const pkcs8Pem = this.getPkcs8Pem();

    // Import the key with jose
    const joseKey = await importPKCS8(pkcs8Pem, algorithm);

    // Create a 30-second JWT
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: algorithm })
      .setSubject(this.fingerprint)
      .setIssuedAt()
      .setExpirationTime('30s')
      .sign(joseKey);

    return jwt;
  }
}

// Singleton instance
let providerInstance: JwtAuthProvider | null = null;

/**
 * Get the singleton JWT auth provider instance
 */
export function getJwtAuthProvider(): JwtAuthProvider {
  if (!providerInstance) {
    providerInstance = new JwtAuthProvider();
  }
  return providerInstance;
}

/**
 * Reset the JWT auth provider singleton
 * Call this after auth config changes to force reinitialization with new key
 */
export function resetJwtAuthProvider(): void {
  providerInstance = null;
}

/**
 * Check if JWT auth is available
 */
export function isAuthAvailable(): boolean {
  return getJwtAuthProvider().isReady();
}

/**
 * Get the Authorization header if auth is available
 * Throws if there's an auth configuration error (e.g., encrypted key)
 * Returns empty object with warning if no key is configured
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const provider = getJwtAuthProvider();
  if (!provider.isReady()) {
    const error = provider.getError();
    if (error) {
      throw error;
    }
    console.warn(
      'Warning: No SSH key configured for authentication. Run "px auth login" to configure.'
    );
    return {};
  }

  const token = await provider.createToken();
  return { Authorization: `Bearer ${token}` };
}
