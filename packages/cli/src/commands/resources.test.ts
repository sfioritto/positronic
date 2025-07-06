import { describe, it, expect } from '@jest/globals';
import {
  createTestServer,
  testCliCommand,
  copyTestResources,
} from './test-utils.js';

describe('CLI Integration: positronic resources types', () => {
  it('should generate type definitions for resources', async () => {
    const server = await createTestServer({
      setup: (dir) => {
        copyTestResources(dir);
      },
    });

    try {
      const { output } = await testCliCommand(['resources', 'types'], {
        server,
      });
    } finally {
      server.stop();
    }
  });

  // it('should handle empty resources directory', async () => {
  //   const server = await createTestServer();

  //   try {
  //     // Remove the default resources created by createMinimalProject
  //     const resourcesDir = path.join(server.dir, 'resources');
  //     const defaultFiles = fs.readdirSync(resourcesDir);
  //     for (const file of defaultFiles) {
  //       fs.unlinkSync(path.join(resourcesDir, file));
  //     }

  //     // Verify directory is empty
  //     expect(fs.readdirSync(resourcesDir).length).toBe(0);

  //     // Run the types command using cli
  //     const px = cli(server);
  //     const result = px('resources types');

  //     // Command should succeed
  //     expect(result.exitCode).toBe(0);

  //     // Check if the types file was generated
  //     const typesPath = path.join(server.dir, 'resources.d.ts');
  //     expect(fs.existsSync(typesPath)).toBe(true);

  //     // Read and verify the generated content
  //     const content = fs.readFileSync(typesPath, 'utf-8');

  //     // Should still have the basic structure
  //     expect(content).toContain("declare module '@positronic/core'");
  //     expect(content).toContain('interface Resources');
  //     expect(content).toContain('loadText(path: string): Promise<string>');
  //     expect(content).toContain('loadBinary(path: string): Promise<Buffer>');
  //   } finally {
  //     await server.stop();
  //   }
  // });

  // it('should handle resources with special characters', async () => {
  //   const server = await createTestServer({
  //     setup: (dir: string) => {
  //       // Create resources directory
  //       const resourcesDir = path.join(dir, 'resources');
  //       fs.mkdirSync(resourcesDir, { recursive: true });

  //       // Create files with special characters
  //       fs.writeFileSync(path.join(resourcesDir, 'valid_file.txt'), 'content');
  //       fs.writeFileSync(path.join(resourcesDir, '$special.txt'), 'content'); // Valid JS identifier
  //       fs.writeFileSync(path.join(resourcesDir, '_underscore.txt'), 'content'); // Valid JS identifier
  //       fs.writeFileSync(path.join(resourcesDir, '123invalid.txt'), 'content'); // Invalid - starts with number
  //       fs.writeFileSync(
  //         path.join(resourcesDir, 'special-chars!@#.txt'),
  //         'content'
  //       ); // Invalid
  //     },
  //   });

  //   try {
  //     // Run the types command
  //     const px = cli(server);
  //     const result = px('resources types');

  //     // Command should succeed
  //     expect(result.exitCode).toBe(0);

  //     // Check if the types file was generated
  //     const typesPath = path.join(server.dir, 'resources.d.ts');
  //     expect(fs.existsSync(typesPath)).toBe(true);

  //     // Verify the generated content
  //     const content = fs.readFileSync(typesPath, 'utf-8');

  //     // Check valid identifiers are included
  //     expect(content).toContain('valid_file: TextResource;');
  //     expect(content).toContain('$special: TextResource;');
  //     expect(content).toContain('_underscore: TextResource;');

  //     // Check invalid identifiers are excluded
  //     expect(content).not.toContain('123invalid');
  //     expect(content).not.toContain('special-chars');
  //   } finally {
  //     await server.cleanup();
  //   }
  // });

  // it('should correctly identify text vs binary files', async () => {
  //   const server = await createTestServer({
  //     setup: (dir: string) => {
  //       // Create resources directory
  //       const resourcesDir = path.join(dir, 'resources');
  //       fs.mkdirSync(resourcesDir, { recursive: true });

  //       // Create various file types
  //       fs.writeFileSync(path.join(resourcesDir, 'text.txt'), 'text');
  //       fs.writeFileSync(path.join(resourcesDir, 'script.js'), 'code');
  //       fs.writeFileSync(path.join(resourcesDir, 'config.json'), '{}');
  //       fs.writeFileSync(path.join(resourcesDir, 'styles.css'), 'css');

  //       // Create actual binary content for binary files
  //       // JPEG magic bytes
  //       const jpegHeader = Buffer.from([
  //         0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  //       ]);
  //       fs.writeFileSync(path.join(resourcesDir, 'image.jpg'), jpegHeader);

  //       // Random binary data
  //       const binaryData = Buffer.from([
  //         0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
  //       ]);
  //       fs.writeFileSync(path.join(resourcesDir, 'binary.bin'), binaryData);

  //       // PDF magic bytes
  //       const pdfHeader = Buffer.from('%PDF-1.4\n%âÌÊÓ\n');
  //       fs.writeFileSync(path.join(resourcesDir, 'document.pdf'), pdfHeader);
  //     },
  //   });

  //   try {
  //     // Run the types command
  //     const px = cli(server);
  //     const result = px('resources types');

  //     // Command should succeed
  //     expect(result.exitCode).toBe(0);

  //     // Check if the types file was generated
  //     const typesPath = path.join(server.dir, 'resources.d.ts');
  //     expect(fs.existsSync(typesPath)).toBe(true);

  //     // Verify the generated content
  //     const content = fs.readFileSync(typesPath, 'utf-8');

  //     // Check text resources
  //     expect(content).toContain('text: TextResource;');
  //     expect(content).toContain('script: TextResource;');
  //     expect(content).toContain('config: TextResource;');
  //     expect(content).toContain('styles: TextResource;');

  //     // Check binary resources
  //     expect(content).toContain('image: BinaryResource;');
  //     expect(content).toContain('binary: BinaryResource;');
  //     expect(content).toContain('document: BinaryResource;');
  //   } finally {
  //     await server.cleanup();
  //   }
  // });
});
