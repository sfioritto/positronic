import { join } from 'path';
import * as fs from 'fs/promises';
import type { FileStore } from './types';

export class LocalFileStore implements FileStore {
  constructor(private baseDir: string) {}
  async readFile(path: string): Promise<string> {
    const filePath = join(this.baseDir, path);
    return fs.readFile(filePath, 'utf-8');
  }
}