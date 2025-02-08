export interface FileStore {
  readFile(path: string, workflowDir?: string): Promise<string>;
}
