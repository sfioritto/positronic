import { brain } from '../src/dsl/brain.js';
import { createWebhook } from '../src/dsl/webhook.js';
import { z } from 'zod';

describe('webhook type inference', () => {
  it('should infer webhook response types correctly', () => {
    // Create two webhooks with different schemas
    const webhook1 = createWebhook(
      'webhook1',
      z.object({
        field1: z.string(),
        field2: z.number(),
      }),
      async (request) => ({
        type: 'webhook' as const,
        identifier: 'test',
        response: { field1: 'hello', field2: 42 },
      })
    );

    const webhook2 = createWebhook(
      'webhook2',
      z.object({
        field3: z.boolean(),
        field4: z.array(z.string()),
      }),
      async (request) => ({
        type: 'webhook' as const,
        identifier: 'test',
        response: { field3: true, field4: ['a', 'b'] },
      })
    );

    // Create a brain that uses these webhooks
    const myBrain = brain('Test Brain')
      .step('Step 0', () => {
        return {
          initial: 'value',
        };
      })
      .step('Step 1', ({ state }) => {
        return {
          state: {
            ...state,
            step1: 'value',
          },
          waitFor: [webhook1('id1'), webhook2('id2')],
        };
      })
      .step('Step 2', ({ state, response }) => {
        // Type inference test: response should be a union of both webhook response types
        if (response) {
          if ('field1' in response) {
            // webhook1 response - TypeScript should infer these types from the schema
            return {
              ...state,
              webhook1Data: {
                value1: response.field1,
                value2: response.field2,
              },
            };
          } else if ('field3' in response) {
            // webhook2 response - TypeScript should infer these types from the schema
            return {
              ...state,
              webhook2Data: {
                value3: response.field3,
                value4: response.field4,
              },
            };
          }
        }
        return state;
      })
      .step('Step 3', ({ state }) => {
        // State has been accumulated through previous steps
        return state;
      });

    // Runtime assertion to make Jest happy
    // The real test is in the type assertions above, which are checked during TypeScript compilation
    expect(myBrain).toBeDefined();
    expect(myBrain.title).toBe('Test Brain');
  });
});
