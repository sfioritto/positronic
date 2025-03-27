export interface FileSystem {
  readFile(path: string): Promise<string>;
}
