import { join } from 'path';
import * as fs from 'fs/promises';
import type { ResourceLoader } from './types.js';

export class LocalResourceLoader implements ResourceLoader {
  constructor(private baseDir: string) {}

  async load(
    resourceName: string,
    type: 'text' | 'image' | 'binary' = 'text'
  ): Promise<string | Buffer> {
    const filePath = join(this.baseDir, resourceName);

    if (type === 'text') {
      return fs.readFile(filePath, 'utf-8');
    }

    // For image and binary types, return as Buffer
    return fs.readFile(filePath);
  }
}
