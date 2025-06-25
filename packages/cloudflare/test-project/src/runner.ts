import {
  WorkflowRunner,
  type ObjectGenerator,
  type Message,
} from '@positronic/core';

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
    return Promise.resolve({} as any);
  },
};

export const runner = new WorkflowRunner({
  adapters: [],
  client: mockClient,
});
