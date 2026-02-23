import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const LOCAL_AUTH_FILENAME = '.positronic-auth.json';

interface LocalAuthData {
  privateKeyPath: string;
}

/**
 * Read the local auth config from a project root directory.
 * Returns the private key path if configured, or null.
 */
export function readLocalAuth(projectRoot: string): string | null {
  const filePath = join(projectRoot, LOCAL_AUTH_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, 'utf-8');
  const data: LocalAuthData = JSON.parse(raw);
  return data.privateKeyPath || null;
}

/**
 * Write the local auth config to a project root directory.
 */
export function writeLocalAuth(projectRoot: string, keyPath: string): void {
  const filePath = join(projectRoot, LOCAL_AUTH_FILENAME);
  const data: LocalAuthData = { privateKeyPath: keyPath };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Clear the local auth config from a project root directory.
 */
export function clearLocalAuth(projectRoot: string): void {
  const filePath = join(projectRoot, LOCAL_AUTH_FILENAME);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
