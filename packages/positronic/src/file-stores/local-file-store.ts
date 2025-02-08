import { join } from 'path';
import * as fs from 'fs/promises';
import type { FileStore } from './types';
export class LocalFileStore implements FileStore {
  async readFile(path: string, workflowDir?: string): Promise<string> {
    if (workflowDir) {
      path = join(workflowDir, path);
    }
    return fs.readFile(path, 'utf-8');
  }
}