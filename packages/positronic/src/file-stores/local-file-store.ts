import { join } from 'path';
import * as fs from 'fs/promises';
import type { FileSystem } from './types';

export class LocalFileSystem implements FileSystem {
  constructor(private baseDir: string) {}
  async readFile(path: string): Promise<string> {
    const filePath = join(this.baseDir, path);
    return fs.readFile(filePath, 'utf-8');
  }
}