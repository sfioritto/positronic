export interface ResourceLoader {
  load(resourceName: string, type?: 'text'): Promise<string>;
  load(resourceName: string, type: 'binary'): Promise<Buffer>;
  load(
    resourceName: string,
    type?: 'text' | 'binary'
  ): Promise<string | Buffer>;
}
