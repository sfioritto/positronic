import {
  WorkflowRunner,
  type ObjectGenerator,
  type Message,
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

export const runner = new WorkflowRunner({
  adapters: [],
  client: mockClient,
  resources: {
    'test-resource': 'This is a test resource',
    'test-resource-binary': Buffer.from('This is a test resource binary'),
  },
});
