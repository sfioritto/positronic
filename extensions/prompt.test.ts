import { createWorkflow } from "../dsl/new-dsl";
import { promptExtension } from "./prompt";
import { z } from "zod";

describe('prompt extension', () => {
  it('should execute a prompt and store the result', async () => {
    const schema = z.object({
      greeting: z.string()
    });

    const mockClient = {
      execute: jest.fn().mockResolvedValue({ greeting: "Hello, World!" })
    };

    const workflow = createWorkflow("Test Workflow", [promptExtension])
      .prompt("test prompt", {
        template: (context) => `Say hello`,
        responseModel: {
          schema,
          name: 'test-greeting'
        },
        client: mockClient
      });

    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    expect(mockClient.execute).toHaveBeenCalledWith(
      'Say hello',
      expect.objectContaining({
        schema,
        name: 'test-greeting'
      })
    );

    expect(finalEvent?.newContext).toEqual({
      "test-greeting": {
        greeting: "Hello, World!"
      }
    });
  });

  it('should accumulate multiple prompt results', async () => {
    const schema1 = z.object({
      greeting: z.string()
    });

    const schema2 = z.object({
      farewell: z.string()
    });

    const mockClient = {
      execute: jest.fn()
        .mockResolvedValueOnce({ greeting: "Hello!" })
        .mockResolvedValueOnce({ farewell: "Goodbye!" })
    };

    const workflow = createWorkflow("Test Workflow", [promptExtension])
      .prompt("greeting", {
        template: (context) => `Say hello`,
        responseModel: {
          schema: schema1,
          name: 'test-greeting'
        },
        client: mockClient
      })
      .prompt("farewell", {
        template: (context) => `Say goodbye`,
        responseModel: {
          schema: schema2,
          name: 'test-farewell'
        },
        client: mockClient
      });

    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    expect(mockClient.execute).toHaveBeenCalledTimes(2);
    expect(finalEvent?.newContext).toEqual({
      "test-greeting": { greeting: "Hello!" },
      "test-farewell": { farewell: "Goodbye!" }
    });
  });

  it('should use context in prompt template', async () => {
    const schema = z.object({
      response: z.string()
    });

    const mockClient = {
      execute: jest.fn().mockResolvedValue({ response: "Hello, John!" })
    };

    const workflow = createWorkflow("Test Workflow", [promptExtension])
      .step("set name", () => ({ name: "John" }))
      .prompt("greet", {
        template: (context) => `Say hello to ${context.name}`,
        responseModel: {
          schema,
          name: 'test-greeting'
        },
        client: mockClient
      });

    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    expect(mockClient.execute).toHaveBeenCalledWith(
      'Say hello to John',
      expect.any(Object)
    );

    expect(finalEvent?.newContext).toEqual({
      name: "John",
      "test-greeting": { response: "Hello, John!" }
    });
  });

  it('should use a custom reducer to transform the result', async () => {
    const schema = z.object({
      count: z.number()
    });

    const mockClient = {
      execute: jest.fn().mockResolvedValue({ count: 42 })
    };

    const workflow = createWorkflow("Test Workflow", [promptExtension])
      .step("init", () => ({ total: 10 }))
      .prompt("count", {
        template: () => `Return a number`,
        responseModel: {
          schema,
          name: 'count-result'
        },
        client: mockClient,
        reducer: (context, result) => ({
          ...context,
          total: context.total + result.count
        })
      });

    let finalEvent;
    for await (const event of workflow.run()) {
      finalEvent = event;
    }

    expect(mockClient.execute).toHaveBeenCalledWith(
      'Return a number',
      expect.any(Object)
    );

    expect(finalEvent?.newContext).toEqual({
      total: 52  // 10 + 42
    });
  });
});