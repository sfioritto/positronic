import { workflow, applyPatches, type ResourceLoader, LocalShell } from "@positronic/core";
import './index';

class TestResourceLoader implements ResourceLoader {
  load = jest.fn().mockImplementation(async () => 'content');
}

// Mock fs.promises.readFile
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn()
  }
}));

const mockClient = {
  execute: jest.fn()
};

// Initialize shell for tests
const mockShell = new LocalShell();

describe('files extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should read files and add them to state', async () => {
    const resources = new TestResourceLoader();
    // Mock readFile responses
    resources.load
      .mockResolvedValueOnce('content 1')
      .mockResolvedValueOnce('content 2')
      .mockResolvedValueOnce('content 3');

    const testWorkflow = workflow('Files Test')
      .fs.file('single', '/path/to/single.txt')
      .fs.files('Multiple files', {
        file1: '/path/to/file1.txt',
        file2: '/path/to/file2.txt'
      });

    let finalState = {};
    for await (const event of testWorkflow.run({
      client: mockClient,
      resources,
      shell: mockShell
    })) {
      if (event.type === 'step:complete') {
        finalState = applyPatches(finalState, event.patch);
      }
    }

    // Verify files were read
    expect(resources.load).toHaveBeenCalledWith('/path/to/single.txt');
    expect(resources.load).toHaveBeenCalledWith('/path/to/file1.txt');
    expect(resources.load).toHaveBeenCalledWith('/path/to/file2.txt');

    // Verify final state
    expect(finalState).toEqual({
      files: {
        single: 'content 1',
        file1: 'content 2',
        file2: 'content 3'
      }
    });
  });

  it('should correctly type the state with file contents', async () => {
    const resources = new TestResourceLoader();
    const testWorkflow = workflow('Type Test')
      .fs.file('testFile', '/path/to/file.txt')
      .fs.files('Multiple files', {
        file1: '/path/to/file1.txt',
        file2: '/path/to/file2.txt'
      })
      .step('Use file content', ({ state }) => {
        // Type assertion
        type ExpectedState = {
          files: {
            testFile: string;
            file1: string;
            file2: string;
          };
        };
        type ActualState = typeof state;
        type TypeTest = AssertEquals<ActualState, ExpectedState>;
        const _typeAssert: TypeTest = true;

        return state;
      });

    // Mock file reads for runtime verification
    resources.load.mockResolvedValue('test content');

    for await (const event of testWorkflow.run({
      client: mockClient,
      resources,
      shell: mockShell
    })) {
      // Consume events
    }
  });
});

// Helper type for type assertions
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;