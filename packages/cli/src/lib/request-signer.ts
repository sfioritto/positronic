import {
  loadPrivateKey,
  getPrivateKeyFingerprint,
  signWithPrivateKey,
  resolvePrivateKeyPath,
} from './ssh-key-utils.js';
import type sshpk from 'sshpk';
import { existsSync } from 'fs';
import { ProjectConfigManager } from '../commands/project-config-manager.js';

export type SignedHeaders = {
  Signature: string;
  'Signature-Input': string;
  [key: string]: string;
};

/**
 * Request signer for RFC 9421 HTTP Message Signatures
 */
export class RequestSigner {
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
          : new Error('Failed to initialize request signer');
    }
  }

  /**
   * Check if the signer is ready to sign requests
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
   * Sign an HTTP request and return the signature headers
   */
  signRequest(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string
  ): SignedHeaders {
    if (!this.privateKey || !this.fingerprint) {
      throw new Error('Request signer not initialized');
    }

    const parsedUrl = new URL(url);
    const created = Math.floor(Date.now() / 1000);

    // Build the signature base
    const coveredComponents = ['"@method"', '"@path"', '"@authority"'];

    // Add content-type if present
    if (headers['Content-Type'] || headers['content-type']) {
      coveredComponents.push('"content-type"');
    }

    // Create the signature base string
    const signatureBaseLines: string[] = [];

    for (const component of coveredComponents) {
      const componentName = component.replace(/"/g, '');

      if (componentName === '@method') {
        signatureBaseLines.push(`"@method": ${method.toUpperCase()}`);
      } else if (componentName === '@path') {
        signatureBaseLines.push(`"@path": ${parsedUrl.pathname}`);
      } else if (componentName === '@authority') {
        signatureBaseLines.push(`"@authority": ${parsedUrl.host}`);
      } else {
        // Regular header
        const headerValue =
          headers[componentName] ||
          headers[componentName.toLowerCase()] ||
          headers[componentName.charAt(0).toUpperCase() + componentName.slice(1)];
        if (headerValue) {
          signatureBaseLines.push(`"${componentName.toLowerCase()}": ${headerValue}`);
        }
      }
    }

    // Create the signature-params line
    const signatureParams = `(${coveredComponents.join(' ')});created=${created};keyid="${this.fingerprint}"`;
    signatureBaseLines.push(`"@signature-params": ${signatureParams}`);

    const signatureBase = signatureBaseLines.join('\n');

    // Sign the base
    const signatureBytes = signWithPrivateKey(this.privateKey, signatureBase);
    const signatureValue = signatureBytes.toString('base64');

    return {
      Signature: `sig1=:${signatureValue}:`,
      'Signature-Input': `sig1=${signatureParams}`,
    };
  }
}

// Singleton instance
let signerInstance: RequestSigner | null = null;

/**
 * Get the singleton request signer instance
 */
export function getRequestSigner(): RequestSigner {
  if (!signerInstance) {
    signerInstance = new RequestSigner();
  }
  return signerInstance;
}

/**
 * Reset the request signer singleton
 * Call this after auth config changes to force reinitialization with new key
 */
export function resetRequestSigner(): void {
  signerInstance = null;
}

/**
 * Check if request signing is available
 */
export function isSigningAvailable(): boolean {
  return getRequestSigner().isReady();
}

/**
 * Sign an HTTP request if signing is available
 * Returns the additional headers to add, or empty object if signing is not available
 */
export function maybeSignRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string
): Record<string, string> {
  const signer = getRequestSigner();
  if (!signer.isReady()) {
    return {};
  }

  try {
    return signer.signRequest(method, url, headers, body);
  } catch (error) {
    console.error('Warning: Failed to sign request:', error);
    return {};
  }
}
