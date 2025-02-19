export interface FileStore {
  readFile(path: string): Promise<string>;
}
