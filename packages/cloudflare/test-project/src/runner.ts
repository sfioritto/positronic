import {
  WorkflowRunner,
  type ObjectGenerator,
  type Message,
  type ResourceLoader,
  createResources,
  type ResourceManifest,
} from '@positronic/core';
import { z, type TypeOf } from 'zod';

// A simple mock client for testing purposes
const mockClient: ObjectGenerator = {
  generateObject: async <T>(params: {
    schema: T;
    schemaName: string;
    schemaDescription?: string;
    prompt?: string;
    messages?: Message[];
    system?: string;
  }) => {
    return Promise.resolve({} as TypeOf<any>);
  },
};

const mockResourceLoader: ResourceLoader = {
  load: (async (
    resourceName: string,
    type?: 'text' | 'binary'
  ): Promise<string | Buffer> => {
    if (type === 'binary') {
      return Buffer.from('This is a test resource binary');
    }
    return 'This is a test resource';
  }) as ResourceLoader['load'],
};

const manifest: ResourceManifest = {
  'test-resource': { key: 'test-resource', type: 'text' },
  'test-resource-binary': { key: 'test-resource-binary', type: 'binary' },
};

const resources = createResources(mockResourceLoader, manifest);

export const runner = new WorkflowRunner({
  adapters: [],
  client: mockClient,
  resources,
});
