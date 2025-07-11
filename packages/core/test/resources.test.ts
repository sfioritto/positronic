import { createResources, type Manifest } from '../src/resources/resources.js';
import { ResourceLoader } from '../src/resources/resource-loader.js';

// Mock loader for testing
class MockLoader implements ResourceLoader {
  private mockData: Record<string, string | Buffer> = {
    'example.md': 'Example content',
    'my file with spaces.txt': 'Content with spaces in filename',
    'data/2024-report.pdf': Buffer.from('Mock PDF content'),
    'docs/readme.md': 'Documentation content',
    'special-chars!@#.txt': 'Special characters content',
  };

  addMockData(path: string, content: string | Buffer): void {
    this.mockData[path] = content;
  }

  async load(key: string, type: 'text'): Promise<string>;
  async load(key: string, type: 'binary'): Promise<Buffer>;
  async load(key: string, type: 'text' | 'binary'): Promise<string | Buffer> {
    const data = this.mockData[key];
    if (!data) {
      throw new Error(`Resource not found: ${key}`);
    }

    if (type === 'text' && Buffer.isBuffer(data)) {
      return data.toString();
    }
    if (type === 'binary' && typeof data === 'string') {
      return Buffer.from(data);
    }

    return data;
  }
}

describe('Resources API', () => {
  let resources: any;

  beforeEach(() => {
    const manifest: Manifest = {
      'example.md': {
        type: 'text',
        path: 'example.md',
        key: 'example.md',
      },
      'my file with spaces.txt': {
        type: 'text',
        path: 'my file with spaces.txt',
        key: 'my file with spaces.txt',
      },
      data: {
        '2024-report.pdf': {
          type: 'binary',
          path: 'data/2024-report.pdf',
          key: 'data/2024-report.pdf',
        },
      },
      docs: {
        'readme.md': {
          type: 'text',
          path: 'docs/readme.md',
          key: 'docs/readme.md',
        },
      },
      'special-chars!@#.txt': {
        type: 'text',
        path: 'special-chars!@#.txt',
        key: 'special-chars!@#.txt',
      },
    };

    const loader = new MockLoader();
    resources = createResources(loader, manifest);
  });

  describe('Proxy API (for JS-identifier compatible names)', () => {
    it('should load simple resource via proxy', async () => {
      const content = await resources.example.loadText();
      expect(content).toBe('Example content');
    });

    it('should load nested resource via proxy', async () => {
      const content = await resources.docs.readme.loadText();
      expect(content).toBe('Documentation content');
    });

    it('should load binary resource via proxy', async () => {
      const buffer = await resources.data['2024-report.pdf'].loadBinary();
      expect(buffer.toString()).toBe('Mock PDF content');
    });
  });

  describe('Method API (for any filename)', () => {
    it('should load resource with spaces in name', async () => {
      const content = await resources.loadText('my file with spaces.txt');
      expect(content).toBe('Content with spaces in filename');
    });

    it('should load nested resource by path', async () => {
      const content = await resources.loadText('docs/readme.md');
      expect(content).toBe('Documentation content');
    });

    it('should load binary resource by path', async () => {
      const buffer = await resources.loadBinary('data/2024-report.pdf');
      expect(buffer.toString()).toBe('Mock PDF content');
    });

    it('should load resource with special characters', async () => {
      const content = await resources.loadText('special-chars!@#.txt');
      expect(content).toBe('Special characters content');
    });

    it('should throw error for non-existent resource', async () => {
      await expect(resources.loadText('non-existent.txt')).rejects.toThrow(
        'Resource not found: non-existent.txt'
      );
    });

    it('should throw error when using wrong type method', async () => {
      await expect(resources.loadText('data/2024-report.pdf')).rejects.toThrow(
        'Resource "data/2024-report.pdf" is of type "binary", but was accessed with loadText()'
      );

      await expect(resources.loadBinary('example.md')).rejects.toThrow(
        'Resource "example.md" is of type "text", but was accessed with loadBinary()'
      );
    });
  });

  describe('Mixed usage', () => {
    it('should support both APIs in the same brain', async () => {
      // Use proxy API for clean names
      const example = await resources.example.loadText();

      // Use method API for names with spaces
      const withSpaces = await resources.loadText('my file with spaces.txt');

      // Both should work
      expect(example).toBe('Example content');
      expect(withSpaces).toBe('Content with spaces in filename');
    });
  });

  describe('Ambiguous resource names', () => {
    let ambiguousResources: any;

    beforeEach(() => {
      const ambiguousManifest: Manifest = {
        'example.md': {
          type: 'text',
          path: 'example.md',
          key: 'example.md',
        },
        'example.txt': {
          type: 'text',
          path: 'example.txt',
          key: 'example.txt',
        },
        'report.pdf': {
          type: 'binary',
          path: 'report.pdf',
          key: 'report.pdf',
        },
        'report.docx': {
          type: 'binary',
          path: 'report.docx',
          key: 'report.docx',
        },
        nested: {
          'config.json': {
            type: 'text',
            path: 'nested/config.json',
            key: 'nested/config.json',
          },
          'config.yaml': {
            type: 'text',
            path: 'nested/config.yaml',
            key: 'nested/config.yaml',
          },
        },
      };

      const mockLoader = new MockLoader();
      // Add the ambiguous files to mock data
      mockLoader.addMockData('example.md', 'Example markdown content');
      mockLoader.addMockData('example.txt', 'Example text content');
      mockLoader.addMockData('report.pdf', Buffer.from('PDF content'));
      mockLoader.addMockData('report.docx', Buffer.from('DOCX content'));
      mockLoader.addMockData('nested/config.json', '{"config": "json"}');
      mockLoader.addMockData('nested/config.yaml', 'config: yaml');

      ambiguousResources = createResources(mockLoader, ambiguousManifest);
    });

    it('should throw error when accessing ambiguous resource via proxy', () => {
      expect(() => ambiguousResources.example).toThrow(
        "Ambiguous resource name 'example': found example.md, example.txt. " +
          "Please use resources.loadText('example.md') or resources.loadBinary('example.txt') instead."
      );
    });

    it('should throw error for ambiguous binary resources', () => {
      expect(() => ambiguousResources.report).toThrow(
        "Ambiguous resource name 'report': found report.pdf, report.docx"
      );
    });

    it('should throw error for ambiguous nested resources', () => {
      expect(() => ambiguousResources.nested.config).toThrow(
        "Ambiguous resource name 'config': found config.json, config.yaml"
      );
    });

    it('should allow direct access with full filename', async () => {
      const markdownContent = await ambiguousResources['example.md'].loadText();
      const textContent = await ambiguousResources['example.txt'].loadText();

      expect(markdownContent).toBe('Example markdown content');
      expect(textContent).toBe('Example text content');
    });

    it('should work with method API for ambiguous resources', async () => {
      const markdownContent = await ambiguousResources.loadText('example.md');
      const textContent = await ambiguousResources.loadText('example.txt');

      expect(markdownContent).toBe('Example markdown content');
      expect(textContent).toBe('Example text content');
    });

    it('should handle ambiguous paths in loadText/loadBinary methods', async () => {
      // Should work with full path
      const jsonContent = await ambiguousResources.loadText(
        'nested/config.json'
      );
      expect(jsonContent).toBe('{"config": "json"}');

      // Should throw error for ambiguous path without extension
      await expect(
        ambiguousResources.loadText('nested/config')
      ).rejects.toThrow(
        "Ambiguous resource path 'nested/config': found config.json, config.yaml. " +
          'Please specify the full filename with extension.'
      );
    });
  });
});
