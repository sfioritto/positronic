export interface ResourceLoader {
  load(
    resourceName: string,
    type?: 'text' | 'image' | 'binary'
  ): Promise<string | Buffer>;
}
