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

  describe('resources list command', () => {
    it('should handle empty resources', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);
        const found = await waitForOutput(/No resources found in the project/);
        expect(found).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display resources with tree structure', async () => {
      const env = await createTestEnv();

      // Add resources with nested structure
      env.server.addResource({
        key: 'readme.txt',
        type: 'text',
        size: 1024,
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'data/config.json',
        type: 'text',
        size: 2048,
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'data/users/admin.json',
        type: 'text',
        size: 512,
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'images/logo.png',
        type: 'binary',
        size: 10240,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);

        // Check tree structure is displayed
        const foundTree = await waitForOutput(/resources/);
        expect(foundTree).toBe(true);

        // Check for files in root
        const foundReadme = await waitForOutput(/readme\.txt/);
        expect(foundReadme).toBe(true);

        // Check for nested directories
        const foundData = await waitForOutput(/data/);
        expect(foundData).toBe(true);

        const foundConfig = await waitForOutput(/config\.json/);
        expect(foundConfig).toBe(true);

        // Check for deeply nested
        const foundUsers = await waitForOutput(/users/);
        expect(foundUsers).toBe(true);

        const foundAdmin = await waitForOutput(/admin\.json/);
        expect(foundAdmin).toBe(true);

        // Check for images directory
        const foundImages = await waitForOutput(/images/);
        expect(foundImages).toBe(true);

        const foundLogo = await waitForOutput(/logo\.png/);
        expect(foundLogo).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display file sizes with correct formatting', async () => {
      const env = await createTestEnv();

      // Add resources with various sizes
      env.server.addResource({
        key: 'small.txt',
        type: 'text',
        size: 500, // 500 bytes
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'medium.txt',
        type: 'text',
        size: 1536, // 1.5 KB
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'large.bin',
        type: 'binary',
        size: 1048576, // 1 MB
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'huge.bin',
        type: 'binary',
        size: 10485760, // 10 MB
        lastModified: new Date().toISOString(),
        local: true,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);

        // Check size formatting
        const foundSmall = await waitForOutput(/small\.txt.*500 B/);
        expect(foundSmall).toBe(true);

        const foundMedium = await waitForOutput(/medium\.txt.*1\.5 KB/);
        expect(foundMedium).toBe(true);

        const foundLarge = await waitForOutput(/large\.bin.*1\.0 MB/);
        expect(foundLarge).toBe(true);

        const foundHuge = await waitForOutput(/huge\.bin.*10\.0 MB/);
        expect(foundHuge).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should indicate local vs remote resources', async () => {
      const env = await createTestEnv();

      // Add mix of local and remote resources
      env.server.addResource({
        key: 'local-file.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: true,
      });
      env.server.addResource({
        key: 'remote-file.txt',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);

        // Check both files are listed
        const foundLocal = await waitForOutput(/local-file\.txt/);
        expect(foundLocal).toBe(true);

        const foundRemote = await waitForOutput(/remote-file\.txt/);
        expect(foundRemote).toBe(true);

        // Remote resources should have arrow indicator
        const foundArrow = await waitForOutput(/↗/);
        expect(foundArrow).toBe(true);

        // Should show legend for uploaded resources
        const foundLegend = await waitForOutput(
          /uploaded resource \(not in local filesystem\)/
        );
        expect(foundLegend).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show loading state', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Stop server to simulate slow loading
        env.server.stop();

        const { waitForOutput, instance } = await px(['resources', 'list']);

        // Should show loading message initially
        const foundLoading = await waitForOutput(/Loading resources\.\.\./);
        expect(foundLoading).toBe(true);

        // Should eventually show error when server is down
        const foundError = await waitForOutput(/Error connecting/);
        expect(foundError).toBe(true);
      } finally {
        // Cleanup without stopping server (already stopped)
        (await env.cleanupTempDir?.()) || (await env.cleanup?.());
      }
    });

    it('should display resource count summary', async () => {
      const env = await createTestEnv();

      // Add multiple resources
      for (let i = 1; i <= 5; i++) {
        env.server.addResource({
          key: `file${i}.txt`,
          type: 'text',
          size: 100 * i,
          lastModified: new Date().toISOString(),
          local: i % 2 === 0, // Even numbers are local
        });
      }

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);

        // Should show count in format "Found X resources:"
        const foundCount = await waitForOutput(/Found 5 resources:/);
        expect(foundCount).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show single resource properly', async () => {
      const env = await createTestEnv();

      // Add a single resource to test singular form
      env.server.addResource({
        key: 'single.txt',
        type: 'text',
        size: 42,
        lastModified: new Date().toISOString(),
        local: true,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'list']);

        // Should show "Found 1 resource:" (singular)
        const foundCount = await waitForOutput(/Found 1 resource:/);
        expect(foundCount).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('resources delete command', () => {
    it('should show error when resource does not exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          'non-existent.txt',
        ]);

        // Should show checking state
        const foundChecking = await waitForOutput(/Checking resource\.\.\./);
        expect(foundChecking).toBe(true);

        // Should show warning for non-existent resource
        const foundWarning = await waitForOutput(
          /Warning: This will permanently delete/
        );
        expect(foundWarning).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should prevent deletion of local resources', async () => {
      const env = await createTestEnv();

      // Add a local resource
      env.server.addResource({
        key: 'local-file.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: true,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          'local-file.txt',
        ]);

        // Should show error about local resource
        const foundError = await waitForOutput(/Cannot Delete Local Resource/);
        expect(foundError).toBe(true);

        // Should show explanation
        const foundExplanation = await waitForOutput(
          /This resource was synced from your local filesystem/
        );
        expect(foundExplanation).toBe(true);

        // Should show instructions
        const foundInstructions = await waitForOutput(
          /delete the file locally and run 'px resources sync'/
        );
        expect(foundInstructions).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show confirmation prompt for remote resources', async () => {
      const env = await createTestEnv();

      // Add a remote resource
      env.server.addResource({
        key: 'remote-file.txt',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          'remote-file.txt',
        ]);

        // Should show warning
        const foundWarning = await waitForOutput(
          /Warning: This will permanently delete the following resource/
        );
        expect(foundWarning).toBe(true);

        // Should show the resource path
        const foundPath = await waitForOutput(/remote-file\.txt/);
        expect(foundPath).toBe(true);

        // Should show confirmation prompt
        const foundPrompt = await waitForOutput(
          /Type "yes" to confirm deletion:/
        );
        expect(foundPrompt).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should delete resource when using force flag', async () => {
      const env = await createTestEnv();

      // Add a remote resource BEFORE starting the server
      env.server.addResource({
        key: 'to-delete.txt',
        type: 'text',
        size: 300,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          '-f',
          'to-delete.txt',
        ]);

        // Should check resource first
        const foundChecking = await waitForOutput(/Checking resource\.\.\./);
        expect(foundChecking).toBe(true);

        // Should show success message (may skip the deleting message due to speed)
        const foundSuccess = await waitForOutput(
          /✅ Successfully deleted: to-delete\.txt/
        );
        expect(foundSuccess).toBe(true);

        // Verify the resource was actually deleted
        const calls = env.server.getLogs();
        const deleteCall = calls.find(
          (c) => c.method === 'deleteResource' && c.args[0] === 'to-delete.txt'
        );
        expect(deleteCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should still prevent deletion of local resources with force flag', async () => {
      const env = await createTestEnv();

      // Add a local resource
      env.server.addResource({
        key: 'local-file.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: true,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          '-f',
          'local-file.txt',
        ]);

        // Should still show error about local resource even with force flag
        const foundError = await waitForOutput(/Cannot Delete Local Resource/);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle API connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput } = await px(
          ['resources', 'upload', '-d', 'any-resource.txt'],
          { server: env.server }
        );

        // Should show checking message first
        const foundChecking = await waitForOutput(/Checking resource\.\.\./);
        expect(foundChecking).toBe(true);

        // Should eventually show connection error
        const foundError = await waitForOutput(/Error connecting/);
        expect(foundError).toBe(true);
      } finally {
        // Just cleanup temp dir since server was never started
      }
    });

    it('should handle nested resource paths with force flag', async () => {
      const env = await createTestEnv();

      // Add a nested resource
      env.server.addResource({
        key: 'folder/subfolder/nested-file.txt',
        type: 'text',
        size: 800,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          '-f',
          'folder/subfolder/nested-file.txt',
        ]);

        // Should delete successfully
        const foundSuccess = await waitForOutput(
          /✅ Successfully deleted: folder\/subfolder\/nested-file\.txt/
        );
        expect(foundSuccess).toBe(true);

        // Verify the resource was deleted
        const calls = env.server.getLogs();
        const deleteCall = calls.find(
          (c) =>
            c.method === 'deleteResource' &&
            c.args[0] === 'folder/subfolder/nested-file.txt'
        );
        expect(deleteCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle nested resource paths without force flag', async () => {
      const env = await createTestEnv();

      // Add a nested resource
      env.server.addResource({
        key: 'folder/nested.txt',
        type: 'text',
        size: 400,
        lastModified: new Date().toISOString(),
        local: false,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          'folder/nested.txt',
        ]);

        // Should show the full nested path in the warning
        const foundPath = await waitForOutput(/folder\/nested\.txt/);
        expect(foundPath).toBe(true);

        // Should show confirmation prompt
        const foundPrompt = await waitForOutput(
          /Type "yes" to confirm deletion:/
        );
        expect(foundPrompt).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show loading state while checking resource', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Stop server to simulate slow loading
        env.server.stop();

        const { waitForOutput } = await px([
          'resources',
          'upload',
          '-d',
          'any-file.txt',
        ]);

        // Should show checking message
        const foundChecking = await waitForOutput(/Checking resource\.\.\./);
        expect(foundChecking).toBe(true);

        // Should eventually show error when server is down
        const foundError = await waitForOutput(/Error/);
        expect(foundError).toBe(true);
      } finally {
        // Cleanup without stopping server (already stopped)
        (await env.cleanupTempDir?.()) || (await env.cleanup?.());
      }
    });
  });

  describe('resources clear command', () => {
    it('should handle empty resources gracefully', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // TestDevServer starts with empty resources by default
        const { waitForOutput } = await px(['resources', 'clear']);
        const isOutputRendered = await waitForOutput(
          /No resources to delete/,
          20
        );

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
        lastModified: new Date().toISOString(),
      });
      env.server.addResource({
        key: 'data/config.json',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['resources', 'clear']);

        // Should show danger warning
        const isWarningShown = await waitForOutput(
          /DANGER: This will permanently delete ALL resources!/
        );
        expect(isWarningShown).toBe(true);

        // Should show resource count (2 resources)
        const isCountShown = await waitForOutput(
          /This action will delete 2 resource\(s\)/
        );
        expect(isCountShown).toBe(true);

        // Should show the selection prompt
        const isPromptShown = await waitForOutput(
          /Use arrow keys to select, Enter to confirm:/
        );
        expect(isPromptShown).toBe(true);

        // Should show cancel option as selected by default
        const isCancelSelected = await waitForOutput(
          /▶ Cancel \(keep resources\)/
        );
        expect(isCancelSelected).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should navigate between options with arrow keys', async () => {
      const env = await createTestEnv();

      // Add a mock resource so we get the confirmation prompt
      env.server.addResource({
        key: 'test.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['resources', 'clear']);

        // Wait for the prompt to appear
        await waitForOutput(/Use arrow keys to select, Enter to confirm:/);

        // Verify cancel is selected by default
        const isCancelSelected = await waitForOutput(
          /▶ Cancel \(keep resources\)/
        );
        expect(isCancelSelected).toBe(true);

        // Press down arrow
        instance.stdin.write('\u001B[B');

        // Should show delete option as selected
        const isDeleteSelected = await waitForOutput(
          /▶ Delete all resources/,
          30
        );
        expect(isDeleteSelected).toBe(true);

        // Press up arrow to go back
        instance.stdin.write('\u001B[A');

        // Should show cancel option as selected again
        const isCancelSelectedAgain = await waitForOutput(
          /▶ Cancel \(keep resources\)/,
          30
        );
        expect(isCancelSelectedAgain).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
