import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { createBrain } from '../src/dsl/create-brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import {
  mockGenerateObject,
  mockStreamText,
  dummyOutputSchema,
  dummyStateKey,
} from './brain-test-helpers.js';

describe('withTools vs withExtraTools semantics', () => {
  const agentMockGenerateText =
    jest.fn<NonNullable<ObjectGenerator['generateText']>>();
  const agentMockClient: jest.Mocked<ObjectGenerator> = {
    generateObject: mockGenerateObject,
    generateText: agentMockGenerateText,
    streamText: mockStreamText,
  };

  beforeEach(() => {
    mockGenerateObject.mockReset();
    agentMockGenerateText.mockReset();
  });

  // Helper to make agent immediately call done
  function setupDoneAgent() {
    agentMockGenerateText.mockResolvedValue({
      text: undefined,
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'done', args: { result: 'ok' } },
      ],
      usage: { totalTokens: 10 },
      responseMessages: [],
    });
  }

  it('withTools() replaces default tools entirely', async () => {
    setupDoneAgent();

    const myTool: any = {
      description: 'My custom tool',
      inputSchema: z.object({ x: z.string() }),
      execute: async () => 'custom result',
    };

    const testBrain = brain('tools-replace')
      .withTools({ myTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have myTool and done (auto-generated), but NOT the defaults like generateUI, consoleLog, etc.
    expect(agentStart.tools).toContain('myTool');
    expect(agentStart.tools).toContain('done');
    expect(agentStart.tools).not.toContain('generateUI');
    expect(agentStart.tools).not.toContain('consoleLog');
    expect(agentStart.tools).not.toContain('print');
    expect(agentStart.tools).not.toContain('waitForWebhook');
  });

  it('withExtraTools() adds tools alongside defaults', async () => {
    setupDoneAgent();

    const defaultTool: any = {
      description: 'A default tool',
      inputSchema: z.object({}),
      execute: async () => 'default',
    };

    const extraTool: any = {
      description: 'An extra tool',
      inputSchema: z.object({ y: z.number() }),
      execute: async () => 'extra',
    };

    const testBrain = brain('tools-extra')
      .withTools({ defaultTool })
      .withExtraTools({ extraTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have both defaultTool and extraTool plus done
    expect(agentStart.tools).toContain('defaultTool');
    expect(agentStart.tools).toContain('extraTool');
    expect(agentStart.tools).toContain('done');
  });

  it('step-level tools override both defaults and extras', async () => {
    setupDoneAgent();

    const defaultTool: any = {
      description: 'A default tool',
      inputSchema: z.object({}),
      execute: async () => 'default',
    };

    const extraTool: any = {
      description: 'An extra tool',
      inputSchema: z.object({}),
      execute: async () => 'extra',
    };

    const overrideTool: any = {
      description: 'Override of default tool',
      inputSchema: z.object({}),
      execute: async () => 'overridden',
    };

    const stepOnlyTool: any = {
      description: 'Step-only tool',
      inputSchema: z.object({}),
      execute: async () => 'step',
    };

    const testBrain = brain('tools-step-override')
      .withTools({ defaultTool })
      .withExtraTools({ extraTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools: {
          ...tools,
          defaultTool: overrideTool, // override the default
          stepOnlyTool, // add step-specific tool
        },
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have all tools
    expect(agentStart.tools).toContain('defaultTool');
    expect(agentStart.tools).toContain('extraTool');
    expect(agentStart.tools).toContain('stepOnlyTool');
    expect(agentStart.tools).toContain('done');

    // Verify the override took effect by checking which tool description was passed to generateText
    const generateTextCall = agentMockGenerateText.mock.calls[0][0] as any;
    expect(generateTextCall.tools.defaultTool.description).toBe(
      'Override of default tool'
    );
  });

  it('withTools() after createBrain() replaces project defaults', async () => {
    setupDoneAgent();

    const projectDefault: any = {
      description: 'Project default tool',
      inputSchema: z.object({}),
      execute: async () => 'project',
    };

    const brainFn = createBrain({
      defaultTools: { projectDefault },
    });

    const myOnlyTool: any = {
      description: 'My only tool',
      inputSchema: z.object({ val: z.string() }),
      execute: async () => 'only',
    };

    // Calling withTools on a brain created by createBrain should replace projectDefault
    const testBrain = brainFn('tools-createbrain-replace')
      .withTools({ myOnlyTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have myOnlyTool and done, but NOT projectDefault
    expect(agentStart.tools).toContain('myOnlyTool');
    expect(agentStart.tools).toContain('done');
    expect(agentStart.tools).not.toContain('projectDefault');
  });
});
