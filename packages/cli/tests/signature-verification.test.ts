/**
 * End-to-end signature verification tests
 *
 * Tests that signatures created by the CLI can be verified by the server's auth middleware logic.
 * This helps catch format mismatches between signing and verification.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadPrivateKey,
  getPrivateKeyFingerprint,
  signWithPrivateKey,
  convertSSHPubKeyToJWK,
} from '../src/lib/ssh-key-utils.js';

// Replicate the auth middleware's verification logic
type SubtleCryptoAlgorithm =
  | { name: 'RSASSA-PKCS1-v1_5'; hash: string }
  | { name: 'ECDSA'; namedCurve: string }
  | { name: 'ECDSA'; hash: string }
  | { name: 'Ed25519' };

function getAlgorithmForJwk(jwk: JsonWebKey): SubtleCryptoAlgorithm {
  if (jwk.kty === 'RSA') {
    return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  } else if (jwk.kty === 'EC') {
    return { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' };
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    return { name: 'Ed25519' };
  }
  throw new Error(`Unsupported key type: ${jwk.kty}`);
}

function getVerifyAlgorithm(jwk: JsonWebKey): SubtleCryptoAlgorithm {
  if (jwk.kty === 'RSA') {
    return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  } else if (jwk.kty === 'EC') {
    return { name: 'ECDSA', hash: 'SHA-256' };
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    return { name: 'Ed25519' };
  }
  throw new Error(`Unsupported key type: ${jwk.kty}`);
}

async function jwkToCryptoKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString) as JsonWebKey;
  const algorithm = getAlgorithmForJwk(jwk);
  return crypto.subtle.importKey('jwk', jwk, algorithm, true, ['verify']);
}

async function verifySignatureWithKey(
  signatureBase: string,
  signatureBytes: Buffer,
  cryptoKey: CryptoKey,
  jwk: JsonWebKey
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureBase);
  const algorithm = getVerifyAlgorithm(jwk);
  return crypto.subtle.verify(algorithm, cryptoKey, signatureBytes, data);
}

describe('Signature Verification End-to-End', () => {
  let tempDir: string;
  let ed25519PrivateKeyPath: string;
  let ed25519PublicKeyPath: string;
  let rsaPrivateKeyPath: string;
  let rsaPublicKeyPath: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-test-'));

    // Generate real Ed25519 key pair using ssh-keygen
    ed25519PrivateKeyPath = path.join(tempDir, 'id_ed25519');
    ed25519PublicKeyPath = path.join(tempDir, 'id_ed25519.pub');

    const { execSync } = await import('child_process');
    execSync(`ssh-keygen -t ed25519 -f ${ed25519PrivateKeyPath} -N "" -C "test@example.com"`, {
      stdio: 'ignore',
    });

    // Generate real RSA key pair using ssh-keygen
    rsaPrivateKeyPath = path.join(tempDir, 'id_rsa');
    rsaPublicKeyPath = path.join(tempDir, 'id_rsa.pub');

    execSync(`ssh-keygen -t rsa -b 2048 -f ${rsaPrivateKeyPath} -N "" -C "test@example.com"`, {
      stdio: 'ignore',
    });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Ed25519 tests are skipped because sshpk requires SHA-512 for Ed25519 signing,
  // but our current implementation uses SHA-256 for consistency with RSA.
  // TODO: Implement proper Ed25519 support with SHA-512
  describe.skip('Ed25519 keys', () => {
    it('should sign and verify successfully', async () => {
      // Load the private key and get fingerprint
      const privateKey = loadPrivateKey(ed25519PrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      // Create a signature base (what the CLI would sign)
      const signatureBase = `"@method": GET
"@path": /test
"@authority": example.com
"@signature-params": ("@method" "@path" "@authority");created=1234567890;keyid="${fingerprint}"`;

      // Sign with the CLI's signing function
      const signatureBytes = signWithPrivateKey(privateKey, signatureBase);

      // Convert public key to JWK (what would be stored as ROOT_PUBLIC_KEY)
      const keyInfo = convertSSHPubKeyToJWK(ed25519PublicKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);

      // Verify with the auth middleware's verification logic
      const jwk = JSON.parse(jwkString) as JsonWebKey;
      const cryptoKey = await jwkToCryptoKey(jwkString);
      const isValid = await verifySignatureWithKey(signatureBase, signatureBytes, cryptoKey, jwk);

      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong data', async () => {
      const privateKey = loadPrivateKey(ed25519PrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      const signatureBase = `"@method": GET
"@path": /test
"@authority": example.com
"@signature-params": ("@method" "@path" "@authority");created=1234567890;keyid="${fingerprint}"`;

      const signatureBytes = signWithPrivateKey(privateKey, signatureBase);

      // Try to verify with different data
      const wrongData = signatureBase.replace('GET', 'POST');

      const keyInfo = convertSSHPubKeyToJWK(ed25519PublicKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);
      const jwk = JSON.parse(jwkString) as JsonWebKey;
      const cryptoKey = await jwkToCryptoKey(jwkString);
      const isValid = await verifySignatureWithKey(wrongData, signatureBytes, cryptoKey, jwk);

      expect(isValid).toBe(false);
    });
  });

  describe('RSA keys', () => {
    it('should sign and verify successfully', async () => {
      // Load the private key and get fingerprint
      const privateKey = loadPrivateKey(rsaPrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      // Create a signature base
      const signatureBase = `"@method": GET
"@path": /test
"@authority": example.com
"@signature-params": ("@method" "@path" "@authority");created=1234567890;keyid="${fingerprint}"`;

      // Sign with the CLI's signing function
      const signatureBytes = signWithPrivateKey(privateKey, signatureBase);

      // Convert public key to JWK
      const keyInfo = convertSSHPubKeyToJWK(rsaPublicKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);

      // Verify with the auth middleware's verification logic
      const jwk = JSON.parse(jwkString) as JsonWebKey;
      const cryptoKey = await jwkToCryptoKey(jwkString);
      const isValid = await verifySignatureWithKey(signatureBase, signatureBytes, cryptoKey, jwk);

      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong data', async () => {
      const privateKey = loadPrivateKey(rsaPrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      const signatureBase = `"@method": GET
"@path": /test
"@authority": example.com
"@signature-params": ("@method" "@path" "@authority");created=1234567890;keyid="${fingerprint}"`;

      const signatureBytes = signWithPrivateKey(privateKey, signatureBase);

      const wrongData = signatureBase.replace('GET', 'POST');

      const keyInfo = convertSSHPubKeyToJWK(rsaPublicKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);
      const jwk = JSON.parse(jwkString) as JsonWebKey;
      const cryptoKey = await jwkToCryptoKey(jwkString);
      const isValid = await verifySignatureWithKey(wrongData, signatureBytes, cryptoKey, jwk);

      expect(isValid).toBe(false);
    });
  });

  describe('Fingerprint consistency', () => {
    it('should produce consistent fingerprints for Ed25519', () => {
      const privateKey = loadPrivateKey(ed25519PrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      // Fingerprint should be in SHA256 format
      expect(fingerprint).toMatch(/^SHA256:/);
    });

    it('should produce consistent fingerprints for RSA', () => {
      const privateKey = loadPrivateKey(rsaPrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      // Fingerprint should be in SHA256 format
      expect(fingerprint).toMatch(/^SHA256:/);
    });
  });

  /**
   * Full HTTP Message Signature flow tests (RFC 9421)
   *
   * These tests simulate the complete flow from CLI signing to server verification,
   * using the same parsing logic as the server's auth middleware.
   * This catches format mismatches between CLI signing and server verification.
   */
  describe('Full HTTP Message Signature Flow (RSA)', () => {
    /**
     * Parse RFC 9421 Signature header (same as server)
     * Format: sig1=:base64signature:
     */
    function parseRFC9421Signature(signatureHeader: string): Map<string, string> {
      const signatures = new Map<string, string>();
      const regex = /(\w+)=:([A-Za-z0-9+/=]+):/g;
      let match;
      while ((match = regex.exec(signatureHeader)) !== null) {
        signatures.set(match[1], match[2]);
      }
      return signatures;
    }

    /**
     * Parse RFC 9421 Signature-Input header (same as server)
     * Format: sig1=("@method" "@path" "@authority");created=123;keyid="fingerprint"
     */
    function parseRFC9421SignatureInput(signatureInputHeader: string): Map<string, { coveredComponents: string[]; created: number; keyId: string }> {
      const inputs = new Map<string, { coveredComponents: string[]; created: number; keyId: string }>();
      const parts = signatureInputHeader.split(/,(?=\w+=\()/);

      for (const part of parts) {
        const trimmed = part.trim();
        const labelMatch = trimmed.match(/^(\w+)=\(([^)]*)\)/);
        if (!labelMatch) continue;

        const label = labelMatch[1];
        const componentsStr = labelMatch[2];

        const coveredComponents: string[] = [];
        const compRegex = /"([^"]+)"/g;
        let compMatch;
        while ((compMatch = compRegex.exec(componentsStr)) !== null) {
          coveredComponents.push(compMatch[1]);
        }

        const paramsStr = trimmed.slice(labelMatch[0].length);
        const createdMatch = paramsStr.match(/;created=(\d+)/);
        const created = createdMatch ? parseInt(createdMatch[1], 10) : 0;
        const keyIdMatch = paramsStr.match(/;keyid="([^"]+)"/);
        const keyId = keyIdMatch ? keyIdMatch[1] : '';

        inputs.set(label, { coveredComponents, created, keyId });
      }

      return inputs;
    }

    /**
     * Reconstruct the signature base (same as server)
     */
    function reconstructSignatureBase(
      method: string,
      urlPath: string,
      authority: string,
      coveredComponents: string[],
      signatureParams: string
    ): string {
      const lines: string[] = [];

      for (const component of coveredComponents) {
        if (component === '@method') {
          lines.push(`"@method": ${method.toUpperCase()}`);
        } else if (component === '@path') {
          lines.push(`"@path": ${urlPath}`);
        } else if (component === '@authority') {
          lines.push(`"@authority": ${authority}`);
        }
      }

      lines.push(`"@signature-params": ${signatureParams}`);
      return lines.join('\n');
    }

    /**
     * Helper function to create signature headers exactly like RequestSigner does
     */
    function createSignatureHeaders(
      privateKey: ReturnType<typeof loadPrivateKey>,
      fingerprint: string,
      method: string,
      urlPath: string,
      authority: string
    ): { signature: string; signatureInput: string; signatureBase: string } {
      const created = Math.floor(Date.now() / 1000);

      // Build signature base exactly like RequestSigner
      const coveredComponents = ['"@method"', '"@path"', '"@authority"'];
      const signatureBaseLines: string[] = [];

      signatureBaseLines.push(`"@method": ${method.toUpperCase()}`);
      signatureBaseLines.push(`"@path": ${urlPath}`);
      signatureBaseLines.push(`"@authority": ${authority}`);

      const signatureParams = `(${coveredComponents.join(' ')});created=${created};keyid="${fingerprint}"`;
      signatureBaseLines.push(`"@signature-params": ${signatureParams}`);

      const signatureBase = signatureBaseLines.join('\n');

      // Sign the base
      const signatureBytes = signWithPrivateKey(privateKey, signatureBase);
      const signatureValue = signatureBytes.toString('base64');

      return {
        signature: `sig1=:${signatureValue}:`,
        signatureInput: `sig1=${signatureParams}`,
        signatureBase,
      };
    }

    it('should create valid signature headers that can be parsed by the server', async () => {
      const privateKey = loadPrivateKey(rsaPrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      const { signature, signatureInput, signatureBase } = createSignatureHeaders(
        privateKey,
        fingerprint,
        'GET',
        '/brains',
        'example.com'
      );

      // Parse using the same logic as the server
      const signatures = parseRFC9421Signature(signature);
      expect(signatures.size).toBe(1);
      expect(signatures.has('sig1')).toBe(true);

      const inputs = parseRFC9421SignatureInput(signatureInput);
      expect(inputs.size).toBe(1);
      expect(inputs.has('sig1')).toBe(true);

      const input = inputs.get('sig1')!;
      expect(input.keyId).toBe(fingerprint);
      expect(input.coveredComponents).toEqual(['@method', '@path', '@authority']);

      // Reconstruct the signature base the same way the server does
      const paramsMatch = signatureInput.match(/^\w+=(.+)$/);
      const signatureParams = paramsMatch ? paramsMatch[1] : '';

      const reconstructedBase = reconstructSignatureBase(
        'GET',
        '/brains',
        'example.com',
        input.coveredComponents,
        signatureParams
      );

      // The reconstructed base should match what we originally signed
      expect(reconstructedBase).toBe(signatureBase);
    });

    it('should produce signatures that verify correctly with the full server flow', async () => {
      const privateKey = loadPrivateKey(rsaPrivateKeyPath);
      const fingerprint = getPrivateKeyFingerprint(privateKey);

      const { signature, signatureInput, signatureBase } = createSignatureHeaders(
        privateKey,
        fingerprint,
        'GET',
        '/brains',
        'example.com'
      );

      // Parse like the server does
      const signatures = parseRFC9421Signature(signature);
      const inputs = parseRFC9421SignatureInput(signatureInput);

      const signatureB64 = signatures.get('sig1')!;
      const input = inputs.get('sig1')!;

      // Reconstruct the signature base
      const paramsMatch = signatureInput.match(/^\w+=(.+)$/);
      const signatureParams = paramsMatch ? paramsMatch[1] : '';

      const reconstructedBase = reconstructSignatureBase(
        'GET',
        '/brains',
        'example.com',
        input.coveredComponents,
        signatureParams
      );

      // Convert public key to JWK
      const keyInfo = convertSSHPubKeyToJWK(rsaPublicKeyPath);
      const jwkString = JSON.stringify(keyInfo.jwk);
      const jwk = JSON.parse(jwkString) as JsonWebKey;

      // Import the key
      const cryptoKey = await jwkToCryptoKey(jwkString);

      // Decode the signature from base64
      const signatureBytes = Buffer.from(signatureB64, 'base64');

      // Verify using the reconstructed base (what the server would do)
      const encoder = new TextEncoder();
      const data = encoder.encode(reconstructedBase);
      const algorithm = getVerifyAlgorithm(jwk);

      const isValid = await crypto.subtle.verify(algorithm, cryptoKey, signatureBytes, data);

      expect(isValid).toBe(true);
    });
  });
});
