import {
  WorkflowRunner,
  type ObjectGenerator,
  type Message,
  type ResourceLoader,
  createResources,
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

const resourceManifest = {
  testResource: { type: 'text' },
  testResourceBinary: { type: 'binary' },
  nestedResource: { testNestedResource: { type: 'text' } },
} as const;

const resources = createResources(mockResourceLoader, resourceManifest);

export const runner = new WorkflowRunner({
  adapters: [],
  client: mockClient,
  resources,
});
