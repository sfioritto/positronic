import { z } from 'zod';
import { jest } from '@jest/globals';
import { brain, BRAIN_EVENTS } from '../src/index.js';
import type { ObjectGenerator, BrainEvent } from '../src/index.js';

describe('Brain withOptionsSchema', () => {
  const mockClient: ObjectGenerator = {
    generateObject: jest.fn().mockResolvedValue({ result: 'test' }),
  };

  // Helper to collect all events
  async function collectAllEvents<T>(
    generator: AsyncGenerator<BrainEvent<T>>
  ): Promise<BrainEvent<T>[]> {
    const events: BrainEvent<T>[] = [];
    for await (const event of generator) {
      events.push(event);
    }
    return events;
  }

  describe('Schema validation', () => {
    it('should validate options against the schema', async () => {
      const optionsSchema = z.object({
        name: z.string(),
        age: z.number().min(0),
      });

      const myBrain = brain('test')
        .withOptionsSchema(optionsSchema)
        .step('Process', ({ state, options }) => ({
          message: `${options.name} is ${options.age} years old`,
        }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          options: { name: 'Alice', age: 30 },
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
    });

    it('should throw an error for invalid options', async () => {
      const optionsSchema = z.object({
        name: z.string(),
        age: z.number().min(0),
      });

      const myBrain = brain('test')
        .withOptionsSchema(optionsSchema)
        .step('Process', ({ options }) => ({ name: options.name }));

      await expect(async () => {
        await collectAllEvents(
          myBrain.run({
            client: mockClient,
            options: { name: 'Alice', age: -5 } as any,
          })
        );
      }).rejects.toThrow();
    });

    it('should apply schema defaults when options are not provided', async () => {
      const optionsSchema = z.object({
        name: z.string().default('Anonymous'),
        count: z.number().default(0),
      });

      const myBrain = brain('test')
        .withOptionsSchema(optionsSchema)
        .step('Process', ({ options }) => ({
          message: `${options.name} has count ${options.count}`,
        }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          // No options provided, should use defaults
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
      // TODO: verify state has default values once implementation is complete
    });
  });

  describe('Error handling', () => {
    it('should throw error for invalid options when schema is defined', async () => {
      const schema = z.object({
        required: z.string(),
      });
      
      const myBrain = brain('test')
        .withOptionsSchema(schema)
        .step('Process', ({ state }) => state);

      await expect(async () => {
        await collectAllEvents(
          myBrain.run({
            client: mockClient,
            options: { wrong: 'field' } as any,
          })
        );
      }).rejects.toThrow();
    });

    it('should allow running without options when no schema is defined', async () => {
      const myBrain = brain('test').step('Process', () => ({ done: true }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          // No options
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
    });
  });

  describe('Fluent API and type inference', () => {
    it('should maintain fluent API pattern', () => {
      const schema = z.object({ flag: z.boolean() });
      
      const myBrain = brain('test')
        .withOptionsSchema(schema)
        .step('Step1', ({ options }) => ({ enabled: options.flag }))
        .step('Step2', ({ state }) => ({ ...state, processed: true }));

      // Should be able to chain methods
      expect(myBrain).toBeDefined();
      expect(myBrain.title).toBe('test');
    });

    it('should work with withServices', () => {
      const schema = z.object({ apiKey: z.string() });
      const services = { logger: console };

      const myBrain = brain('test')
        .withOptionsSchema(schema)
        .withServices(services)
        .step('Log', ({ options, logger }) => {
          logger.log(options.apiKey);
          return { logged: true };
        });

      expect(myBrain).toBeDefined();
    });
  });

  describe('Complex schemas', () => {
    it('should handle nested object schemas', async () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
        settings: z.object({
          theme: z.enum(['light', 'dark']).default('light'),
          notifications: z.boolean().default(true),
        }),
      });

      const myBrain = brain('test')
        .withOptionsSchema(schema)
        .step('Process', ({ options }) => ({
          userName: options.user.name,
          theme: options.settings.theme,
        }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          options: {
            user: { name: 'Bob', email: 'bob@example.com' },
            settings: { theme: 'dark' },
          },
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
    });

    it('should handle optional fields with defaults', async () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        withDefault: z.string().default('default value'),
      });

      const myBrain = brain('test')
        .withOptionsSchema(schema)
        .step('Process', ({ options }) => ({
          req: options.required,
          opt: options.optional,
          def: options.withDefault,
        }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          options: { required: 'test' },
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
    });
  });

  describe('Type parameter compatibility', () => {
    it('should still work with type parameter approach', async () => {
      // This is the existing pattern that should continue to work
      type MyOptions = {
        name: string;
        count: number;
      };

      const myBrain = brain<MyOptions>('test').step('Process', ({ options }) => ({
        message: `${options.name} has count ${options.count}`,
      }));

      const events = await collectAllEvents(
        myBrain.run({
          client: mockClient,
          options: { name: 'Test', count: 42 },
        })
      );

      const completeEvent = events.find(e => e.type === BRAIN_EVENTS.COMPLETE);
      expect(completeEvent).toBeDefined();
    });
  });
});