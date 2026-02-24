import { brain } from '../src/dsl/brain.js';
import { createWebhook } from '../src/dsl/webhook.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { z } from 'zod';
import type { ObjectGenerator } from '../src/clients/types.js';
import { jest } from '@jest/globals';

const mockClient: ObjectGenerator = {
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
};

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
          ...state,
          step1: 'value',
        };
      })
      .wait('Wait for webhooks', () => [webhook1('id1'), webhook2('id2')])
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

describe('wait step timeout', () => {
  const testWebhook = createWebhook(
    'timeout-test-webhook',
    z.object({ data: z.string() }),
    async (request) => ({
      type: 'webhook' as const,
      identifier: 'test',
      response: { data: 'hello' },
    })
  );

  it('should emit WEBHOOK event without timeout when no timeout specified', async () => {
    const testBrain = brain('no-timeout brain')
      .step('Init', () => ({ ready: true }))
      .wait('Wait', () => testWebhook('id1'));

    const events = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK) as any;
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent.timeout).toBeUndefined();
  });

  it('should emit WEBHOOK event with timeout in ms when timeout string specified', async () => {
    const testBrain = brain('timeout-string brain')
      .step('Init', () => ({ ready: true }))
      .wait('Wait', () => testWebhook('id1'), { timeout: '24h' });

    const events = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK) as any;
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent.timeout).toBe(24 * 60 * 60 * 1000);
  });

  it('should emit WEBHOOK event with timeout in ms when timeout number specified', async () => {
    const testBrain = brain('timeout-number brain')
      .step('Init', () => ({ ready: true }))
      .wait('Wait', () => testWebhook('id1'), { timeout: 30000 });

    const events = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK) as any;
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent.timeout).toBe(30000);
  });

  it('should throw on invalid timeout value', () => {
    expect(() => {
      brain('invalid-timeout brain')
        .step('Init', () => ({ ready: true }))
        .wait('Wait', () => testWebhook('id1'), { timeout: 'not-valid' });
    }).toThrow('Invalid duration string');
  });
});
