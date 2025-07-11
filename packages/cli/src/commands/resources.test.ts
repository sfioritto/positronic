import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px, waitForTypesFile } from './test-utils.js';
import path from 'path';
import fs from 'fs';

describe('CLI Integration: positronic resources types', () => {
  it('should generate type definitions for resources', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    try {
      const { waitForOutput, waitForTypesFile } = await px([
        'resources',
        'sync',
      ]);
      const isOutputRendered = await waitForOutput(/sync summary/i);
      const typesContent = await waitForTypesFile('config: TextResource;');
      expect(isOutputRendered).toBe(true);
      const normalizeWhitespace = (str: string) =>
        str.replace(/\s+/g, ' ').trim();

      const expectedContent = `declare module '@positronic/core' {
        interface TextResource {
          load(): Promise<string>;
        }
        interface BinaryResource {
          load(): Promise<Buffer>;
        }
        interface Resources {
          // Method signatures for loading resources by path
          loadText(path: string): Promise<string>;
          loadBinary(path: string): Promise<Buffer>;
          // Resource properties accessible via dot notation
          config: TextResource;
          data: {
            config: TextResource;
            logo: BinaryResource;
          };
          docs: {
            api: TextResource;
            readme: TextResource;
          };
          example: TextResource;
          readme: TextResource;
          test: TextResource;
        }
      }`;

      expect(normalizeWhitespace(typesContent)).toContain(
        normalizeWhitespace(expectedContent)
      );
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle empty resources directory', async () => {
    const env = await createTestEnv();
    const px = await env.start();

    try {
      // Remove the default resources created by createMinimalProject
      const resourcesDir = path.join(env.projectRootDir, 'resources');

      // Remove all contents recursively and recreate empty directory
      fs.rmSync(resourcesDir, { recursive: true, force: true });
      fs.mkdirSync(resourcesDir);

      // Verify directory is empty
      expect(fs.readdirSync(resourcesDir).length).toBe(0);

      // Run the sync command using cli
      const syncElement = await px(['resources', 'sync']);
      const isOutputRendered = await syncElement.waitForOutput(
        /no files found in the resources directory/i
      );
      expect(isOutputRendered).toBe(true);
      const typesContent = await syncElement.waitForTypesFile(
        'loadText(path: string): Promise<string>;'
      );

      // Check if the types file was generated
      expect(typesContent).toBeDefined();

      // Should still have the basic structure
      expect(typesContent).toContain("declare module '@positronic/core'");
      expect(typesContent).toContain('interface Resources');
      expect(typesContent).toContain('loadText(path: string): Promise<string>');
      expect(typesContent).toContain(
        'loadBinary(path: string): Promise<Buffer>'
      );

      // Run the list command
      const listElement = await px(['resources', 'list']);

      const resourceListOutput = await listElement.waitForOutput(
        /no resources found in the project/i
      );

      expect(resourceListOutput).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle resources with special characters', async () => {
    const env = await createTestEnv();

    // Setup files with special characters
    env.setup((dir: string) => {
      // Create resources directory
      const resourcesDir = path.join(dir, 'resources');

      // Remove existing resources directory if it exists
      if (fs.existsSync(resourcesDir)) {
        fs.rmSync(resourcesDir, { recursive: true, force: true });
      }

      // Create fresh resources directory
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create files with special characters
      fs.writeFileSync(path.join(resourcesDir, 'valid_file.txt'), 'content');
      fs.writeFileSync(path.join(resourcesDir, '$special.txt'), 'content'); // Valid JS identifier
      fs.writeFileSync(path.join(resourcesDir, '_underscore.txt'), 'content'); // Valid JS identifier
      fs.writeFileSync(path.join(resourcesDir, '123invalid.txt'), 'content'); // Invalid - starts with number
      fs.writeFileSync(
        path.join(resourcesDir, 'special-chars!@#.txt'),
        'content'
      ); // Invalid
    });

    const px = await env.start();

    try {
      // Run the sync command first (types are generated as part of sync)
      const { waitForOutput, waitForTypesFile } = await px([
        'resources',
        'sync',
      ]);
      const isOutputRendered = await waitForOutput(/sync summary/i);
      expect(isOutputRendered).toBe(true);

      // Wait for types file to be generated
      const typesContent = await waitForTypesFile([
        'valid_file: TextResource;',
        '$special: TextResource;',
        '_underscore: TextResource;',
      ]);

      // Verify the generated content
      expect(typesContent).toBeDefined();

      // Check valid identifiers are included
      expect(typesContent).toContain('valid_file: TextResource;');
      expect(typesContent).toContain('$special: TextResource;');
      expect(typesContent).toContain('_underscore: TextResource;');

      // Check invalid identifiers are excluded
      expect(typesContent).not.toContain('123invalid');
      expect(typesContent).not.toContain('special-chars');
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should correctly identify text vs binary files', async () => {
    const env = await createTestEnv();

    // Setup files with various types
    env.setup((dir: string) => {
      // Create resources directory
      const resourcesDir = path.join(dir, 'resources');

      // Remove existing resources directory if it exists
      if (fs.existsSync(resourcesDir)) {
        fs.rmSync(resourcesDir, { recursive: true, force: true });
      }

      // Create fresh resources directory
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create various file types
      fs.writeFileSync(path.join(resourcesDir, 'text.txt'), 'text');
      fs.writeFileSync(path.join(resourcesDir, 'script.js'), 'code');
      fs.writeFileSync(path.join(resourcesDir, 'config.json'), '{}');
      fs.writeFileSync(path.join(resourcesDir, 'styles.css'), 'css');

      // Create actual binary content for binary files
      // JPEG magic bytes
      const jpegHeader = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);
      fs.writeFileSync(path.join(resourcesDir, 'image.jpg'), jpegHeader);

      // Random binary data
      const binaryData = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
      ]);
      fs.writeFileSync(path.join(resourcesDir, 'binary.bin'), binaryData);

      // PDF magic bytes
      const pdfHeader = Buffer.from('%PDF-1.4\n%âÌÊÓ\n');
      fs.writeFileSync(path.join(resourcesDir, 'document.pdf'), pdfHeader);
    });

    const px = await env.start();

    try {
      // Run the sync command first (types are generated as part of sync)
      const { waitForOutput, waitForTypesFile } = await px([
        'resources',
        'sync',
      ]);

      const isOutputRendered = await waitForOutput(/sync summary/i);
      expect(isOutputRendered).toBe(true);

      // Wait for types file to be generated with expected content
      const typesContent = await waitForTypesFile([
        'text: TextResource;',
        'script: TextResource;',
        'config: TextResource;',
        'styles: TextResource;',
        'image: BinaryResource;',
        'binary: BinaryResource;',
        'document: BinaryResource;',
      ]);

      // Verify the generated content
      expect(typesContent).toBeDefined();

      // Check text resources
      expect(typesContent).toContain('text: TextResource;');
      expect(typesContent).toContain('script: TextResource;');
      expect(typesContent).toContain('config: TextResource;');
      expect(typesContent).toContain('styles: TextResource;');

      // Check binary resources
      expect(typesContent).toContain('image: BinaryResource;');
      expect(typesContent).toContain('binary: BinaryResource;');
      expect(typesContent).toContain('document: BinaryResource;');
    } finally {
      await env.stopAndCleanup();
    }
  });

  describe('resources clear command', () => {
    it('should handle empty resources gracefully', async () => {
      const env = await createTestEnv();
      const px = await env.start();
      
      try {
        // TestDevServer starts with empty resources by default
        const { waitForOutput, instance } = await px(['resources', 'clear']);
        const isOutputRendered = await waitForOutput(/No resources to delete/, 20);
        
        if (!isOutputRendered) {
          console.log('Last frame:', instance.lastFrame());
        }
        
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show warning for non-empty resources', async () => {
      const env = await createTestEnv();
      
      // Add some mock resources to the test server
      env.server.addResource({
        key: 'test.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString()
      });
      env.server.addResource({
        key: 'data/config.json',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString()
      });
      
      const px = await env.start();
      
      try {
        const { waitForOutput } = await px(['resources', 'clear']);
        
        // Should show danger warning
        const isWarningShown = await waitForOutput(/DANGER: This will permanently delete ALL resources!/);
        expect(isWarningShown).toBe(true);
        
        // Should show resource count (2 resources)
        const isCountShown = await waitForOutput(/This action will delete 2 resource\(s\)/);
        expect(isCountShown).toBe(true);
        
        // Should show the confirmation prompt
        const isConfirmPromptShown = await waitForOutput(/Type "yes" to confirm deletion:/);
        expect(isConfirmPromptShown).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
