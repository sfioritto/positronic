import * as path from 'path';
import type { PositronicWatcher } from '@positronic/spec';
// @ts-ignore Could not find a declaration file for module '@positronic/template-new-project'.
import pkg from '@positronic/template-new-project';
const { generateManifest: regenerateManifestFile } = pkg;

export class CloudflareWatcher implements PositronicWatcher {
  async onBrainChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    // Regenerate manifest when brain files change
    const serverDir = path.join(projectRoot, '.positronic');
    const srcDir = path.join(serverDir, 'src');

    console.log(`Brain file ${event}: ${path.relative(projectRoot, filePath)}`);
    await regenerateManifestFile(projectRoot, srcDir);
  }

  async onResourceChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    // For Cloudflare backend, resource changes are handled by the CLI
    // The backend doesn't need to do anything special here
    console.log(
      `Resource file ${event}: ${path.relative(projectRoot, filePath)}`
    );
  }
}
