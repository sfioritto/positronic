import { SignJWT, importPKCS8, base64url } from 'jose';
import { existsSync } from 'fs';
import { createPrivateKey } from 'crypto';
import {
  loadPrivateKey,
  getPrivateKeyFingerprint,
  getPublicKeyFingerprint,
  resolvePrivateKeyPath,
} from './ssh-key-utils.js';
import type sshpk from 'sshpk';
import { ProjectConfigManager } from '../commands/project-config-manager.js';
import { AgentSigner } from './ssh-agent-signer.js';
import { readLocalAuth } from './local-auth.js';

// Module-level state: project root path for local auth resolution
let authProjectRootPath: string | null = null;

/**
 * Check if an error indicates an encrypted key
 */
function isEncryptedKeyError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'KeyEncryptedError') {
    return true;
  }
  return false;
}

/**
 * JWT Auth Provider for authenticating API requests
 * Uses SSH private keys to sign short-lived JWTs
 * Falls back to ssh-agent for encrypted keys
 */
export class JwtAuthProvider {
  private privateKey: sshpk.PrivateKey | null = null;
  private fingerprint: string | null = null;
  private initialized = false;
  private initError: Error | null = null;

  // Agent fallback support
  private encryptedKeyPath: string | null = null;
  private agentSigner: AgentSigner | null = null;
  private agentKey: sshpk.Key | null = null;
  private useAgent = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    try {
      // Get configured path from project config manager
      const configManager = new ProjectConfigManager();

      // Build resolved path with local auth in the priority chain:
      // 1. POSITRONIC_PRIVATE_KEY env var (handled inside resolvePrivateKeyPath)
      // 2. Local project auth file (.positronic-auth.json)
      // 3. Project-specific key from global config
      // 4. Global default key from global config
      // 5. Fallback (~/.ssh/id_rsa)
      let configuredPath: string | null;
      if (!process.env.POSITRONIC_PRIVATE_KEY && authProjectRootPath) {
        const localKeyPath = readLocalAuth(authProjectRootPath);
        if (localKeyPath) {
          configuredPath = localKeyPath;
        } else {
          configuredPath = configManager.getPrivateKeyPath();
        }
      } else {
        configuredPath = configManager.getPrivateKeyPath();
      }

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
      if (isEncryptedKeyError(error)) {
        // Store the path for agent fallback - we'll try the agent in createToken()
        const configManager = new ProjectConfigManager();
        let configuredPathForAgent: string | null;
        if (!process.env.POSITRONIC_PRIVATE_KEY && authProjectRootPath) {
          const localKeyPath = readLocalAuth(authProjectRootPath);
          configuredPathForAgent = localKeyPath || configManager.getPrivateKeyPath();
        } else {
          configuredPathForAgent = configManager.getPrivateKeyPath();
        }
        this.encryptedKeyPath = resolvePrivateKeyPath(configuredPathForAgent);
        this.initError =
          error instanceof Error
            ? error
            : new Error('Key is encrypted');
      } else {
        this.initError =
          error instanceof Error
            ? error
            : new Error('Failed to initialize JWT auth provider');
      }
    }
  }

  /**
   * Check if the provider is ready to create JWTs
   * Returns true if we have a direct key OR if we have an encrypted key
   * that might work with agent fallback
   */
  isReady(): boolean {
    // Direct key is loaded and ready
    if (this.initialized && this.privateKey !== null) {
      return true;
    }
    // Encrypted key might work with agent fallback
    if (this.encryptedKeyPath !== null) {
      return true;
    }
    return false;
  }

  /**
   * Check if we have an encrypted key that requires agent fallback
   */
  hasEncryptedKey(): boolean {
    return this.encryptedKeyPath !== null;
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

    return this.getAlgorithmForKeyType(this.privateKey.type, this.privateKey.curve);
  }

  /**
   * Map SSH key type string to JWT algorithm
   */
  private getAlgorithmForKeyType(keyType: string, curve?: string): string {
    if (keyType === 'rsa') {
      return 'RS256';
    } else if (keyType === 'ecdsa') {
      // ECDSA curve determines algorithm
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
    // If we have a direct private key, use the standard jose signing path
    if (this.privateKey && this.fingerprint) {
      return this.createTokenDirect();
    }

    // If we have an encrypted key path, try agent fallback
    if (this.encryptedKeyPath) {
      await this.tryAgentFallback();
    }

    // If agent fallback succeeded, use agent signing
    if (this.useAgent && this.agentSigner && this.agentKey && this.fingerprint) {
      return this.createTokenWithAgent();
    }

    // No authentication method available
    throw this.initError || new Error('JWT auth provider not initialized');
  }

  /**
   * Create JWT using direct private key (jose library)
   */
  private async createTokenDirect(): Promise<string> {
    if (!this.privateKey || !this.fingerprint) {
      throw new Error('Private key not loaded');
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

  /**
   * Try to use ssh-agent for signing when private key is encrypted
   */
  private async tryAgentFallback(): Promise<void> {
    if (!this.encryptedKeyPath) {
      return;
    }

    // Get fingerprint from public key file
    const pubKeyPath = this.encryptedKeyPath + '.pub';
    if (!existsSync(pubKeyPath)) {
      throw new Error(
        `Key is encrypted and public key file not found at ${pubKeyPath}.\n` +
          `Cannot determine key fingerprint for ssh-agent lookup.`
      );
    }

    const fingerprint = getPublicKeyFingerprint(pubKeyPath);

    const agent = new AgentSigner();
    if (!agent.isAvailable()) {
      throw new Error(
        `Key is encrypted and ssh-agent is not running.\n` +
          `Start ssh-agent or use an unencrypted key.`
      );
    }

    const agentKey = await agent.hasKey(fingerprint);
    if (!agentKey) {
      throw new Error(
        `Key is encrypted and not loaded in ssh-agent.\n` +
          `Run: ssh-add ${this.encryptedKeyPath}`
      );
    }

    this.agentSigner = agent;
    this.agentKey = agentKey;
    this.fingerprint = fingerprint;
    this.useAgent = true;
    this.initError = null;
    this.initialized = true;
  }

  /**
   * Create JWT using ssh-agent for signing
   * Manually constructs the JWT since jose expects to do signing itself
   */
  private async createTokenWithAgent(): Promise<string> {
    if (!this.agentSigner || !this.agentKey || !this.fingerprint) {
      throw new Error('Agent signing not configured');
    }

    // Get algorithm from agent key type
    const keyType = this.agentKey.type;
    const curve = (this.agentKey as unknown as { curve?: string }).curve;
    const algorithm = this.getAlgorithmForKeyType(keyType, curve);

    // Build JWT header
    const header = { alg: algorithm };
    const encodedHeader = base64url.encode(JSON.stringify(header));

    // Build JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: this.fingerprint,
      iat: now,
      exp: now + 30,
    };
    const encodedPayload = base64url.encode(JSON.stringify(payload));

    // Create signing input
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with agent
    const signature = await this.agentSigner.sign(
      this.agentKey,
      Buffer.from(signingInput)
    );

    // Convert sshpk.Signature to raw bytes for JWT
    // sshpk's toBuffer() gives us the raw signature bytes
    const signatureBytes = signature.toBuffer('raw');
    const encodedSignature = base64url.encode(signatureBytes);

    return `${signingInput}.${encodedSignature}`;
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
 * Returns empty object if no key is configured (server will reject if auth is required)
 * Only throws for unexpected errors during token creation
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const provider = getJwtAuthProvider();
  if (!provider.isReady()) {
    // No key configured - return empty headers
    // The server will reject the request if authentication is required
    return {};
  }

  try {
    // createToken() will handle agent fallback for encrypted keys
    const token = await provider.createToken();
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    // Token creation failed (e.g., ssh-agent not running for encrypted key)
    // Return empty headers and let the server reject if auth is required
    return {};
  }
}

/**
 * Set the project root path for local auth resolution.
 * Called once at startup from positronic.ts when in dev mode.
 * Nulls the singleton so it reinitializes on next use with the new path.
 */
export function setAuthProjectRootPath(projectRoot: string | null): void {
  authProjectRootPath = projectRoot;
  providerInstance = null;
}

/**
 * Get the current auth project root path (for use by auth components).
 */
export function getAuthProjectRootPath(): string | null {
  return authProjectRootPath;
}

/**
 * Authenticated fetch wrapper for use with EventSource or other
 * consumers that need a fetch function with automatic JWT authentication.
 * Each fetch call gets a fresh JWT token (tokens have 30-second lifetime).
 */
export const authenticatedFetch: typeof fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const authHeader = await getAuthHeader();
  return fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      ...authHeader,
    },
  });
};
