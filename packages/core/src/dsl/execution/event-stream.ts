import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator, ToolMessage, ResponseMessage } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, AgentTool, AgentConfig, AgentToolWaitFor, StepContext, SignalProvider } from '../types.js';
import { STATUS, BRAIN_EVENTS } from '../constants.js';
import { createPatch, applyPatches } from '../json-patch.js';
import type { Resources } from '../../resources/resources.js';
import type { WebhookRegistration, SerializedWebhookRegistration } from '../webhook.js';
import type { PagesService } from '../pages.js';
import type { UIComponent } from '../../ui/types.js';
import { generateUI } from '../../ui/generate-ui.js';
import { generatePageHtml } from '../../ui/generate-page-html.js';
import type { MemoryProvider, ScopedMemory } from '../../memory/types.js';
import { createScopedMemory } from '../../memory/scoped-memory.js';

import type { BrainEvent } from '../definitions/events.js';
import type { Block, StepBlock, BrainBlock, AgentBlock, GuardBlock, WaitBlock } from '../definitions/blocks.js';
import type { GeneratedPage } from '../definitions/brain-types.js';
import type { InitialRunParams, ResumeRunParams, ResumeContext } from '../definitions/run-params.js';

import { Step } from '../builder/step.js';
import { DEFAULT_ENV, DEFAULT_AGENT_SYSTEM_PROMPT, MAX_RETRIES } from './constants.js';
import { defaultDoneSchema } from '../../tools/index.js';

const clone = <T>(value: T): T => structuredClone(value);

export class BrainEventStream<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
> {
  private currentState: TState;
  private steps: Step[];
  private currentStepIndex: number = 0;
  private brainRunId: string;
  private title: string;
  private description?: string;
  private client: ObjectGenerator;
  private options: TOptions;
  private services: TServices;
  private resources: Resources;
  private pages?: PagesService;
  private env: RuntimeEnv;
  private currentResponse: JsonObject | undefined = undefined;
  private currentPage: GeneratedPage | undefined = undefined;
  private resumeContext?: ResumeContext;
  private components?: Record<string, UIComponent<any>>;
  private defaultTools?: Record<string, AgentTool>;
  private signalProvider?: SignalProvider;
  private memoryProvider?: MemoryProvider;
  private scopedMemory?: ScopedMemory;
  private guards: Map<number, GuardBlock<any, any>> = new Map();
  private waits: Map<number, WaitBlock<any, any, any, any>> = new Map();
  private stopped = false;

  constructor(
    params: (InitialRunParams<TOptions> | ResumeRunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
      defaultTools?: Record<string, AgentTool>;
      memoryProvider?: MemoryProvider;
    }
  ) {
    const {
      blocks,
      title,
      description,
      brainRunId: providedBrainRunId,
      options = {} as TOptions,
      client,
      services,
      resources = {} as Resources,
      pages,
      env,
      components,
      defaultTools,
      signalProvider,
      memoryProvider,
    } = params;

    // Check if this is a resume run or fresh start
    const resumeParams = params as ResumeRunParams<TOptions>;
    const initialParams = params as InitialRunParams<TOptions>;
    const resumeContext = resumeParams.resumeContext;

    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
    this.pages = pages;
    this.env = env ?? DEFAULT_ENV;
    this.resumeContext = resumeContext;
    this.components = components;
    this.defaultTools = defaultTools;
    this.signalProvider = signalProvider;
    this.memoryProvider = memoryProvider;

    // Create scoped memory if provider is configured
    if (memoryProvider) {
      this.scopedMemory = createScopedMemory(memoryProvider, title);
    }

    // Initialize steps - track guard and wait blocks by index
    this.steps = [];
    for (const block of blocks) {
      if (block.type === 'guard') {
        const guardBlock = block as GuardBlock<any, any>;
        this.guards.set(this.steps.length, guardBlock);
      } else if (block.type === 'wait') {
        const waitBlock = block as WaitBlock<any, any, any, any>;
        this.waits.set(this.steps.length, waitBlock);
      }
      this.steps.push(new Step(block));
    }

    if (resumeContext) {
      // Resume: use state and stepIndex directly from resumeContext
      this.currentState = clone(resumeContext.state) as TState;
      this.currentStepIndex = resumeContext.stepIndex;

      // Mark steps before stepIndex as complete (they won't be re-executed)
      for (let i = 0; i < resumeContext.stepIndex; i++) {
        this.steps[i].withStatus(STATUS.COMPLETE);
      }

      // For inner brains (no signalProvider), check resumeContext for webhookResponse
      // The outer brain will have set this from the signal
      if (!signalProvider && resumeContext.webhookResponse && !resumeContext.agentContext) {
        this.currentResponse = resumeContext.webhookResponse;
      }
      // Agent webhook response is handled via agentContext (checked in executeAgent)
    } else {
      // Fresh start: use initialState or empty object
      this.currentState = clone(initialParams.initialState ?? {}) as TState;
      this.currentStepIndex = 0;
    }

    // Use provided ID if available, otherwise generate one
    this.brainRunId = providedBrainRunId ?? uuidv4();
  }

  /**
   * Find webhookResponse anywhere in the resumeContext tree (for nested brain resumes)
   */
  private findWebhookResponseInResumeContext(context: ResumeContext | undefined): JsonObject | undefined {
    if (!context) return undefined;
    if (context.webhookResponse) return context.webhookResponse;
    return this.findWebhookResponseInResumeContext(context.innerResumeContext);
  }

  async *next(): AsyncGenerator<BrainEvent<TOptions>> {
    const {
      steps,
      title: brainTitle,
      description: brainDescription,
      currentState,
      options,
      brainRunId,
    } = this;

    try {
      // Only emit START event for fresh runs, not resumes
      // Resumed brains already have a historical START event
      if (!this.resumeContext) {
        yield {
          type: BRAIN_EVENTS.START,
          status: STATUS.RUNNING,
          brainTitle,
          brainDescription,
          initialState: currentState,
          options,
          brainRunId,
        };

        // Emit initial step status after brain starts
        yield {
          type: BRAIN_EVENTS.STEP_STATUS,
          steps: steps.map((step) => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          brainRunId,
        };
      } else {
        // Resuming - check for WEBHOOK_RESPONSE signal or fall back to resumeContext
        let webhookResponse: JsonObject | undefined;

        if (this.signalProvider) {
          // Outer brain: consume only WEBHOOK signals at resume start
          // Other signals (USER_MESSAGE, CONTROL) remain in queue for processing in step/agent loops
          const signals = await this.signalProvider.getSignals('WEBHOOK');
          const webhookSignal = signals.find(s => s.type === 'WEBHOOK_RESPONSE');

          if (webhookSignal && webhookSignal.type === 'WEBHOOK_RESPONSE') {
            webhookResponse = webhookSignal.response;

            // Set currentResponse for step consumption (non-agent webhooks)
            this.currentResponse = webhookResponse;

            // Set webhookResponse at the deepest level of the resumeContext tree
            // This is needed for:
            // 1. Agent webhook resumes (via resumeContext.webhookResponse)
            // 2. Nested brain resumes (inner brain accesses via innerResumeContext)
            if (this.resumeContext) {
              let deepest = this.resumeContext;
              while (deepest.innerResumeContext) {
                deepest = deepest.innerResumeContext;
              }
              deepest.webhookResponse = webhookResponse;
            }
          }
        } else {
          // Inner brain (no signalProvider): check resumeContext for webhookResponse
          // The outer brain will have set this from the signal
          webhookResponse = this.findWebhookResponseInResumeContext(this.resumeContext);
        }

        if (webhookResponse) {
          // Emit WEBHOOK_RESPONSE to transition state machine from 'waiting' to 'running'
          yield {
            type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
            brainRunId,
            response: webhookResponse,
            options: options ?? ({} as TOptions),
          };
        } else {
          // RESUME signal or default resume behavior - emit RESUMED to transition state machine
          yield {
            type: BRAIN_EVENTS.RESUMED,
            status: STATUS.RUNNING,
            brainTitle,
            brainDescription,
            brainRunId,
            options: options ?? ({} as TOptions),
          };
        }
      }

      // Process each step
      while (this.currentStepIndex < steps.length) {
        // Check for CONTROL signals before each step
        if (this.signalProvider) {
          const signals = await this.signalProvider.getSignals('CONTROL');
          for (const signal of signals) {
            if (signal.type === 'KILL') {
              yield {
                type: BRAIN_EVENTS.CANCELLED,
                status: STATUS.CANCELLED,
                brainTitle,
                brainDescription,
                brainRunId,
                options,
              };
              return;
            }
            if (signal.type === 'PAUSE') {
              yield {
                type: BRAIN_EVENTS.PAUSED,
                status: STATUS.PAUSED,
                brainTitle,
                brainDescription,
                brainRunId,
                options,
              };
              return;
            }
          }
        }

        const step = steps[this.currentStepIndex];

        // Skip completed or skipped steps
        if (step.serialized.status === STATUS.COMPLETE || step.serialized.status === STATUS.HALTED) {
          this.currentStepIndex++;
          continue;
        }

        // Handle guard blocks
        const guard = this.guards.get(this.currentStepIndex);
        if (guard) {
          yield* this.executeGuard(step, guard);
          continue;
        }

        // Handle wait blocks
        const waitBlock = this.waits.get(this.currentStepIndex);
        if (waitBlock) {
          yield* this.executeWait(step, waitBlock);
          this.currentStepIndex++;
          continue;
        }

        // Step start event
        yield {
          type: BRAIN_EVENTS.STEP_START,
          status: STATUS.RUNNING,
          stepTitle: step.block.title,
          stepId: step.id,
          stepIndex: this.currentStepIndex,
          options,
          brainRunId,
        };

        step.withStatus(STATUS.RUNNING);

        // Step Status Event to indicate that the step is running
        yield {
          type: BRAIN_EVENTS.STEP_STATUS,
          steps: steps.map((step) => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          brainRunId,
        };

        // Execute step and yield the STEP_COMPLETE event and
        // all events from inner brains if any
        yield* this.executeStep(step);

        // Backend requested a stop (e.g. batch chunk pause for DO restart)
        if (this.stopped) {
          return;
        }

        // Step Status Event
        yield {
          type: BRAIN_EVENTS.STEP_STATUS,
          steps: steps.map((step) => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          brainRunId,
        };

        this.currentStepIndex++;
      }

      yield {
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle,
        brainDescription,
        brainRunId,
        options,
      };
    } catch (err: any) {
      const error = err as Error;
      const currentStep = steps[this.currentStepIndex];
      currentStep?.withStatus(STATUS.ERROR);

      yield {
        type: BRAIN_EVENTS.ERROR,
        status: STATUS.ERROR,
        brainTitle,
        brainDescription,
        brainRunId,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        options,
      };

      // Step Status Event
      yield {
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: steps.map((step) => {
          const { patch, ...rest } = step.serialized;
          return rest;
        }),
        options,
        brainRunId,
      };

      throw error;
    }
  }

  private async *executeStep(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as Block<any, any, TOptions, TServices, any, any>;

    if (block.type === 'step') {
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any>;

      // Check if this is a UI step - handle specially
      if (stepBlock.isUIStep) {
        yield* this.executeUIStep(step, stepBlock);
        return;
      }

      // Check if this is a batch prompt step - handle specially
      if (stepBlock.batchConfig) {
        yield* this.executeBatchPrompt(step);
        return;
      }
    }

    if (block.type === 'brain') {
      const brainBlock = block as BrainBlock<any, any, any, TOptions, TServices>;
      const initialState =
        typeof brainBlock.initialState === 'function'
          ? brainBlock.initialState(this.currentState)
          : brainBlock.initialState;

      // Check if we're resuming and if there's an inner resume context
      const innerResumeContext = this.resumeContext?.innerResumeContext;

      // Run inner brain and yield all its events
      // Pass brainRunId so inner brain shares outer brain's run ID
      let patches: any[] = [];

      let innerBrainPaused = false;
      const innerRun = innerResumeContext
        ? brainBlock.innerBrain.run({
            resources: this.resources,
            client: this.client,
            resumeContext: innerResumeContext,
            options: this.options ?? ({} as TOptions),
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
          })
        : brainBlock.innerBrain.run({
            resources: this.resources,
            client: this.client,
            initialState,
            options: this.options ?? ({} as TOptions),
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
          });

      for await (const event of innerRun) {
        yield event; // Forward all inner brain events
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          patches.push(event.patch);
        }
        // If inner brain yielded a WEBHOOK event, it's pausing
        if (event.type === BRAIN_EVENTS.WEBHOOK) {
          innerBrainPaused = true;
        }
        // If inner brain completed, break immediately to prevent hanging
        if (event.type === BRAIN_EVENTS.COMPLETE) {
          break;
        }
      }

      // If inner brain paused for webhook, don't complete the outer brain step
      // The outer brain should also pause
      if (innerBrainPaused) {
        return;
      }

      // Apply collected patches to get final inner state
      // When resuming, use the resumed state as base; otherwise use initialState
      const baseState = innerResumeContext?.state ?? initialState;
      const innerState = applyPatches(baseState, patches);

      // Get previous state before action
      const prevState = this.currentState;

      // Update state with inner brain results
      this.currentState = await brainBlock.action(
        this.currentState,
        innerState,
        this.services
      );
      yield* this.completeStep(step, prevState);
    } else if (block.type === 'agent') {
      yield* this.executeAgent(step);
    } else {
      // Get previous state before action
      const prevState = this.currentState;
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any>;

      // Execute step with automatic retry on failure
      let retries = 0;
      let result;

      while (true) {
        try {
          const actionPromise = Promise.resolve(
            stepBlock.action({
              state: this.currentState,
              options: this.options ?? ({} as TOptions),
              client: this.client,
              resources: this.resources,
              response: this.currentResponse,
              page: this.currentPage,
              pages: this.pages,
              env: this.env,
              memory: this.scopedMemory,
              ...this.services,
            })
          );

          result = await actionPromise;
          break; // Success
        } catch (error) {
          if (retries < MAX_RETRIES) {
            retries++;
            yield {
              type: BRAIN_EVENTS.STEP_RETRY,
              stepTitle: step.block.title,
              stepId: step.id,
              error: {
                name: (error as Error).name,
                message: (error as Error).message,
                stack: (error as Error).stack,
              },
              attempt: retries,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
            // Loop continues to retry
          } else {
            throw error;
          }
        }
      }

      // Extract state from result (handles promptResponse case)
      if (result && typeof result === 'object' && 'promptResponse' in result) {
        this.currentState = result.state;
      } else {
        this.currentState = result;
      }
      yield* this.completeStep(step, prevState);

      // Handle promptResponse - set currentResponse for next step
      if (result && typeof result === 'object' && 'promptResponse' in result) {
        this.currentResponse = result.promptResponse;
      }

      // Reset currentPage after step consumes it (page is ephemeral)
      this.currentPage = undefined;
    }
  }

  private async *executeAgent(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as AgentBlock<any, any, TOptions, TServices, any, any, any>;
    const prevState = this.currentState;

    // Get default tools and components for injection into configFn
    const defaultTools = this.defaultTools ?? {};
    const components = this.components ?? {};

    // Get agent configuration - inject tools and components
    const config = await block.configFn({
      state: this.currentState,
      options: this.options ?? ({} as TOptions),
      tools: defaultTools,
      components,
      client: this.client,
      resources: this.resources,
      response: this.currentResponse,
      page: this.currentPage,
      pages: this.pages,
      env: this.env,
      memory: this.scopedMemory,
      ...this.services,
    });

    // Reset currentPage after configFn consumes it (page is ephemeral)
    this.currentPage = undefined;

    // Merge tools: step tools override defaults
    const mergedTools: Record<string, AgentTool> = { ...defaultTools, ...(config.tools ?? {}) };

    // Always generate a 'done' terminal tool for every agent
    // If outputSchema is provided, use that schema; otherwise use defaultDoneSchema
    if (config.outputSchema) {
      const { schema, name } = config.outputSchema;
      mergedTools['done'] = {
        description: `Signal that the task is complete and provide the final ${name} result.

PURPOSE: End agent execution and return structured output to the calling system.

BEHAVIOR:
- This is a TERMINAL tool - calling it immediately ends the agent
- No further tools will execute after this
- No further iterations will occur
- The input you provide becomes the agent's final output

WHEN TO CALL:
- When you have completed the assigned task
- When you have gathered all required information
- When you have the final answer or result ready

DO NOT CALL IF:
- You still need to gather more information
- You are waiting for user input (use waitForWebhook instead)
- The task is not yet complete

The schema for this result is: ${name}`,
        inputSchema: schema,
        terminal: true,
      };
    } else {
      mergedTools['done'] = {
        description: `Signal that the task is complete and provide a summary of what was accomplished.

PURPOSE: End agent execution and return a result string to the calling system.

BEHAVIOR:
- This is a TERMINAL tool - calling it immediately ends the agent
- No further tools will execute after this
- No further iterations will occur
- The result string you provide becomes the agent's final output

WHEN TO CALL:
- When you have completed the assigned task
- When you have gathered all required information
- When you have the final answer ready to report

DO NOT CALL IF:
- You still need to gather more information
- You are waiting for user input (use waitForWebhook instead)
- The task is not yet complete

Provide a clear, concise summary of the outcome in the 'result' field.`,
        inputSchema: defaultDoneSchema,
        terminal: true,
      };
    }

    // Track conversation using SDK-native messages (preserves providerOptions like thoughtSignature)
    let responseMessages: ResponseMessage[] | undefined;
    // Initial messages for first call (will be converted by client)
    let initialMessages: ToolMessage[];

    // Check if we're resuming from a previous agent execution
    const agentContext = this.resumeContext?.agentContext;
    const webhookResponse = this.resumeContext?.webhookResponse;

    // Use preserved stepId from agentContext when resuming, or step.id for fresh start
    // This ensures all events for the same agent use the same stepId across resumes
    const effectiveStepId = agentContext?.stepId ?? step.id;

    if (agentContext) {

      // Check if this is a webhook resume (has webhook response) or pause resume
      if (webhookResponse && agentContext.pendingToolCallId && agentContext.pendingToolName) {
        // WEBHOOK RESUME: Agent was waiting for a webhook response

        // Emit WEBHOOK_RESPONSE event to record the response
        yield {
          type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
          response: webhookResponse,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        // Emit AGENT_TOOL_RESULT for the pending tool (webhook response injected as tool result)
        yield {
          type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          toolCallId: agentContext.pendingToolCallId,
          toolName: agentContext.pendingToolName,
          result: webhookResponse,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        // Use restored responseMessages from the agent context (preserves providerOptions)
        // Prepend the user message and append the webhook response
        // Note: reconstructed messages don't include the placeholder (we don't emit events for it),
        // so we just append the real webhook response here.
        const userMessage: ResponseMessage = { role: 'user', content: agentContext.prompt };

        if (this.client.createToolResultMessage) {
          const toolResultMessage = this.client.createToolResultMessage(
            agentContext.pendingToolCallId,
            agentContext.pendingToolName,
            webhookResponse
          );

          responseMessages = [userMessage, ...agentContext.responseMessages, toolResultMessage];

          // Emit event for this tool result message (for reconstruction if there's another pause)
          yield {
            type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
            stepTitle: step.block.title,
            stepId: effectiveStepId,
            iteration: 0, // Special iteration for resumed webhook response
            message: toolResultMessage,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };
        } else {
          // Fallback if client doesn't support createToolResultMessage
          responseMessages = [userMessage, ...agentContext.responseMessages];
        }

        // Set empty initial messages since user message is in responseMessages
        initialMessages = [];
      } else {
        // PAUSE RESUME: Agent was paused mid-execution (no pending webhook)
        // Restore conversation history and continue from where we left off

        const userMessage: ResponseMessage = { role: 'user', content: agentContext.prompt };
        responseMessages = [userMessage, ...agentContext.responseMessages];
        initialMessages = [];

        // No events to emit for pause resume - we just continue the conversation
      }

      // Clear the resume context so it's only used once
      this.resumeContext = undefined;
    } else {
      // Use "Begin." as default prompt if not provided
      const prompt = config.prompt ?? 'Begin.';

      // Emit agent start event (only for fresh starts)
      yield {
        type: BRAIN_EVENTS.AGENT_START,
        stepTitle: step.block.title,
        stepId: effectiveStepId,
        prompt,
        system: config.system,
        tools: Object.keys(mergedTools),
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Initialize messages for fresh start
      initialMessages = [{ role: 'user', content: prompt }];
    }

    // Initialize token tracking
    let totalTokens = 0;
    let iteration = 0;
    const maxIterations = config.maxIterations ?? 100;

    // Main agent loop
    while (true) {
      iteration++;

      // Check for ALL signals at start of iteration
      if (this.signalProvider) {
        const signals = await this.signalProvider.getSignals('ALL');
        for (const signal of signals) {
          if (signal.type === 'KILL') {
            yield {
              type: BRAIN_EVENTS.CANCELLED,
              status: STATUS.CANCELLED,
              brainTitle: this.title,
              brainDescription: this.description,
              brainRunId: this.brainRunId,
              options: this.options,
            };
            return;
          }
          if (signal.type === 'PAUSE') {
            yield {
              type: BRAIN_EVENTS.PAUSED,
              status: STATUS.PAUSED,
              brainTitle: this.title,
              brainDescription: this.description,
              brainRunId: this.brainRunId,
              options: this.options,
            };
            return;
          }
          if (signal.type === 'USER_MESSAGE') {
            // Emit event for user message injection
            yield {
              type: BRAIN_EVENTS.AGENT_USER_MESSAGE,
              stepTitle: step.block.title,
              stepId: effectiveStepId,
              content: signal.content,
              options: this.options,
              brainRunId: this.brainRunId,
            };

            // Inject as user message into conversation
            const userMessage: ResponseMessage = { role: 'user', content: signal.content };
            if (responseMessages) {
              responseMessages = [...responseMessages, userMessage];
            } else {
              initialMessages = [...initialMessages, { role: 'user', content: signal.content }];
            }

            // Emit raw response message event so it shows up in agent chat view
            yield {
              type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
              stepTitle: step.block.title,
              stepId: effectiveStepId,
              iteration,
              message: userMessage,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
          }
        }
      }

      // Check max iterations limit BEFORE making the LLM call
      if (iteration > maxIterations) {
        yield {
          type: BRAIN_EVENTS.AGENT_ITERATION_LIMIT,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          iteration: iteration - 1, // Report the last completed iteration
          maxIterations,
          totalTokens,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        yield* this.completeStep(step, prevState);
        return;
      }

      // Check if client supports generateText
      if (!this.client.generateText) {
        throw new Error(
          'Client does not support generateText. Use a client that implements generateText for agent steps.'
        );
      }

      // Build tools object for the client (description and inputSchema only)
      const toolsForClient: Record<
        string,
        { description: string; inputSchema: z.ZodSchema }
      > = {};
      for (const [name, toolDef] of Object.entries(mergedTools)) {
        const tool = toolDef as AgentTool;
        let description = tool.description;

        // Enrich generateUI description with available component information
        if (name === 'generateUI' && components && Object.keys(components).length > 0) {
          const componentList = Object.entries(components)
            .map(([compName, comp]) => {
              const desc = comp.description.split('\n')[0]; // First line only
              return `- ${compName}: ${desc}`;
            })
            .join('\n');

          description = `Generate a web page for displaying rich content or collecting user input.

Sometimes you need more than simple notifications to communicate with users. This tool creates web pages that can display formatted content, dashboards, or forms to collect information.

AVAILABLE COMPONENTS:
${componentList}

RETURNS: { url: string, webhook: { slug: string, identifier: string, token: string } | null }
- url: The page URL
- webhook: For forms (hasForm=true), contains slug, identifier, and token that must all be passed to waitForWebhook to pause execution until the user submits the form

IMPORTANT: Users have no way to discover the page URL on their own. After generating a page, you must tell them the URL using whatever communication tools are available.`;
        }

        toolsForClient[name] = {
          description,
          inputSchema: tool.inputSchema,
        };
      }

      // Prepend default system prompt to user's system prompt
      const systemPrompt = config.system
        ? `${DEFAULT_AGENT_SYSTEM_PROMPT}\n\n${config.system}`
        : DEFAULT_AGENT_SYSTEM_PROMPT;

      const response = await this.client.generateText({
        system: systemPrompt,
        messages: initialMessages,
        responseMessages,
        tools: toolsForClient,
        toolChoice: config.toolChoice,
      });

      // Update responseMessages for next iteration (preserves providerOptions)
      responseMessages = response.responseMessages;

      // Get the new assistant message (the last one added by generateText)
      const newAssistantMessage = response.responseMessages?.at(-1);

      // Emit event for the assistant message
      if (newAssistantMessage) {
        yield {
          type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          iteration,
          message: newAssistantMessage,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
      }

      // Track tokens
      const tokensThisIteration = response.usage.totalTokens;
      totalTokens += tokensThisIteration;

      // Emit iteration event (after LLM call so we have token info)
      yield {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        stepTitle: step.block.title,
        stepId: effectiveStepId,
        iteration,
        tokensThisIteration,
        totalTokens,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Check max tokens limit
      if (config.maxTokens && totalTokens > config.maxTokens) {
        yield {
          type: BRAIN_EVENTS.AGENT_TOKEN_LIMIT,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          totalTokens,
          maxTokens: config.maxTokens,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        yield* this.completeStep(step, prevState);
        return;
      }

      // Handle assistant text response (emit event and log)
      if (response.text) {
        // Log assistant messages to console as fallback (users shouldn't rely on this)
        console.log(`[Assistant] ${response.text}`);

        yield {
          type: BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          content: response.text,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
      }

      // If no tool calls, agent is done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield* this.completeStep(step, prevState);
        return;
      }

      // Track pending webhook if any tool returns waitFor
      // We process ALL tool calls first, then pause for webhook at the end
      let pendingWebhook: {
        toolCallId: string;
        toolName: string;
        input: JsonObject;
        webhooks: Array<{ slug: string; identifier: string }>;
      } | null = null;

      // Process tool calls
      for (const toolCall of response.toolCalls) {
        yield {
          type: BRAIN_EVENTS.AGENT_TOOL_CALL,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.args as JsonObject,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        const tool = mergedTools[toolCall.toolName];
        if (!tool) {
          throw new Error(`Unknown tool: ${toolCall.toolName}`);
        }

        // Check if this is a terminal tool
        if (tool.terminal) {
          yield {
            type: BRAIN_EVENTS.AGENT_COMPLETE,
            stepTitle: step.block.title,
            stepId: effectiveStepId,
            terminalToolName: toolCall.toolName,
            result: toolCall.args as JsonObject,
            totalIterations: iteration,
            totalTokens,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          // Merge terminal result into state
          // Only namespace under outputSchema.name when 'done' tool is called with outputSchema
          if (config.outputSchema && toolCall.toolName === 'done') {
            // Namespace result under outputSchema.name
            this.currentState = {
              ...this.currentState,
              [config.outputSchema.name]: toolCall.args,
            };
          } else {
            // Default behavior: spread into state root (for other terminal tools)
            this.currentState = { ...this.currentState, ...(toolCall.args as JsonObject) };
          }
          yield* this.completeStep(step, prevState);
          return;
        }

        if (tool.execute) {
          const toolContext: StepContext = {
            state: this.currentState,
            options: this.options ?? ({} as JsonObject),
            client: this.client,
            resources: this.resources,
            response: this.currentResponse,
            page: this.currentPage,
            pages: this.pages,
            env: this.env,
            components: this.components,
            brainRunId: this.brainRunId,
            stepId: effectiveStepId,
            memory: this.scopedMemory,
          };

          const toolResult = await tool.execute(toolCall.args, toolContext);

          // Check if tool returned waitFor
          if (
            toolResult &&
            typeof toolResult === 'object' &&
            'waitFor' in toolResult
          ) {
            const waitForResult = toolResult as AgentToolWaitFor;

            // Normalize waitFor to array (supports single or multiple webhooks)
            const webhooks = Array.isArray(waitForResult.waitFor)
              ? waitForResult.waitFor
              : [waitForResult.waitFor];

            // Store webhook info - we'll emit the events after processing all tool calls
            // This ensures all other tool results are processed before pausing
            pendingWebhook = {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.args as JsonObject,
              webhooks: webhooks.map((w) => ({
                slug: w.slug,
                identifier: w.identifier,
                token: w.token,
              })),
            };

            // Emit tool result event for debugging/visibility (with pending status)
            yield {
              type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
              stepTitle: step.block.title,
              stepId: effectiveStepId,
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              result: { status: 'waiting_for_webhook', webhooks: pendingWebhook.webhooks },
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };

            // Add placeholder to responseMessages locally so the conversation stays valid
            // for any subsequent generateText calls in this execution.
            // We DON'T emit an event for it - on resume, we reconstruct from events
            // and append the real webhook response.
            if (this.client.createToolResultMessage && responseMessages) {
              const placeholderMessage = this.client.createToolResultMessage(
                toolCall.toolCallId,
                toolCall.toolName,
                { status: 'waiting_for_webhook', webhooks: pendingWebhook.webhooks }
              );
              responseMessages = [...responseMessages, placeholderMessage];
            }

            // Continue processing other tool calls - don't return yet
            continue;
          }

          // Emit tool result event for debugging/visibility
          yield {
            type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
            stepTitle: step.block.title,
            stepId: effectiveStepId,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            result: toolResult,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          // Create tool result message using SDK-native format (preserves providerOptions)
          if (this.client.createToolResultMessage && responseMessages) {
            const toolResultMessage = this.client.createToolResultMessage(
              toolCall.toolCallId,
              toolCall.toolName,
              toolResult
            );
            responseMessages = [...responseMessages, toolResultMessage];

            // Emit event for this tool result message
            yield {
              type: BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE,
              stepTitle: step.block.title,
              stepId: effectiveStepId,
              iteration,
              message: toolResultMessage,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
          }
        }
      }

      // After processing all tool calls, check if we need to pause for a webhook
      if (pendingWebhook) {
        // Emit AGENT_WEBHOOK event
        yield {
          type: BRAIN_EVENTS.AGENT_WEBHOOK,
          stepTitle: step.block.title,
          stepId: effectiveStepId,
          toolCallId: pendingWebhook.toolCallId,
          toolName: pendingWebhook.toolName,
          input: pendingWebhook.input,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        // Emit WEBHOOK event with all webhooks (first response wins)
        yield {
          type: BRAIN_EVENTS.WEBHOOK,
          waitFor: pendingWebhook.webhooks,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        return;
      }
    }
  }

  /**
   * Execute a batch prompt step in chunks, yielding one BATCH_CHUNK_COMPLETE
   * event per chunk. Between chunks, checks for PAUSE/KILL signals so
   * Cloudflare backends can restart the DO to reclaim memory.
   */
  private async *executeBatchPrompt(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as StepBlock<any, any, TOptions, TServices, any, any>;
    const batchConfig = block.batchConfig!;
    const prevState = this.currentState;
    const client = batchConfig.client ?? this.client;
    const items = batchConfig.over(this.currentState);
    const totalItems = items.length;
    const chunkSize = batchConfig.chunkSize ?? 10;

    // Resume support: pick up from where we left off
    const batchProgress = this.resumeContext?.batchProgress;
    const startIndex = batchProgress?.processedCount ?? 0;
    const results: ([any, any] | undefined)[] = batchProgress?.accumulatedResults
      ? [...batchProgress.accumulatedResults]
      : new Array(totalItems);

    // Clear resumeContext after consuming batchProgress
    if (batchProgress) {
      this.resumeContext = undefined;
    }

    for (let chunkStart = startIndex; chunkStart < totalItems; chunkStart += chunkSize) {
      // Check signals before each chunk (allows Cloudflare adapter to pause between chunks)
      if (this.signalProvider) {
        const signals = await this.signalProvider.getSignals('CONTROL');
        for (const signal of signals) {
          if (signal.type === 'KILL') {
            yield {
              type: BRAIN_EVENTS.CANCELLED,
              status: STATUS.CANCELLED,
              brainTitle: this.title,
              brainDescription: this.description,
              brainRunId: this.brainRunId,
              options: this.options ?? ({} as TOptions),
            };
            return;
          }
          if (signal.type === 'PAUSE') {
            // Don't yield PAUSED - pausing between batch chunks is a backend
            // implementation detail (e.g. Cloudflare DO restart for memory).
            // Just stop execution silently; the backend handles resume.
            this.stopped = true;
            return;
          }
        }
      }

      const chunkEnd = Math.min(chunkStart + chunkSize, totalItems);
      const chunk = items.slice(chunkStart, chunkEnd);

      // Process chunk concurrently
      const chunkResults = await Promise.all(
        chunk.map(async (item: any) => {
          try {
            const promptText = await batchConfig.template(item, this.resources);
            const output = await client.generateObject({
              schema: batchConfig.schema,
              schemaName: batchConfig.schemaName,
              prompt: promptText,
              ...(batchConfig.maxRetries !== undefined && { maxRetries: batchConfig.maxRetries }),
            });
            return [item, output] as [any, any];
          } catch (error) {
            if (batchConfig.error) {
              const fallback = batchConfig.error(item, error as Error);
              return fallback !== null ? ([item, fallback] as [any, any]) : undefined;
            }
            throw error;
          }
        })
      );

      // Store chunk results at correct indices
      for (let i = 0; i < chunkResults.length; i++) {
        results[chunkStart + i] = chunkResults[i];
      }

      // Yield ONE event per chunk
      yield {
        type: BRAIN_EVENTS.BATCH_CHUNK_COMPLETE,
        stepTitle: step.block.title,
        stepId: step.id,
        chunkStartIndex: chunkStart,
        processedCount: chunkEnd,
        totalItems,
        chunkResults,
        schemaName: batchConfig.schemaName,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };
    }

    // All chunks done - update state and complete step
    const finalResults = results.filter((r): r is [any, any] => r != null);
    this.currentState = { ...this.currentState, [batchConfig.schemaName]: finalResults };
    yield* this.completeStep(step, prevState);
  }

  /**
   * Execute a UI generation step.
   * Generates UI components, renders to HTML, creates page, and sets up webhook.
   */
  private async *executeUIStep(
    step: Step,
    stepBlock: StepBlock<any, any, TOptions, TServices, any, any>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const prevState = this.currentState;

    // Validate required configuration
    if (!this.components) {
      throw new Error(
        `UI step "${stepBlock.title}" requires components to be configured via brain.withComponents()`
      );
    }
    if (!this.pages) {
      throw new Error(
        `UI step "${stepBlock.title}" requires pages service to be configured`
      );
    }

    const uiConfig = stepBlock.uiConfig!;

    // Get the prompt from template (with heartbeat for long-running template functions)
    const prompt = await uiConfig.template(this.currentState, this.resources);

    const uiResult = await generateUI({
      client: this.client,
      prompt,
      components: this.components,
      schema: uiConfig.responseSchema,
      data: this.currentState as Record<string, unknown>,
    });

    if (!uiResult.rootId) {
      // Provide detailed debug information
      const placementCount = uiResult.placements.length;
      const placementInfo = uiResult.placements
        .map(p => `${p.component}(parentId: ${p.parentId ?? 'null'})`)
        .join(', ');

      if (placementCount === 0) {
        throw new Error(
          `UI generation failed for step "${stepBlock.title}" - no components were placed. ` +
          `The LLM may not have called any component tools. ` +
          `LLM response text: ${uiResult.text ?? '(none)'}`
        );
      } else {
        throw new Error(
          `UI generation failed for step "${stepBlock.title}" - no root component found. ` +
          `${placementCount} component(s) were placed but all have a parentId: [${placementInfo}]. ` +
          `The first component should be placed without a parentId to serve as the root.`
        );
      }
    }

    // Create unique identifier for this form submission webhook
    const webhookIdentifier = `${this.brainRunId}-${step.id}`;

    // Generate CSRF token for form submission validation
    const formToken = crypto.randomUUID();

    // Construct form action URL for the webhook
    const formAction = `${this.env.origin}/webhooks/system/ui-form?identifier=${encodeURIComponent(webhookIdentifier)}`;

    // Generate HTML page
    const html = generatePageHtml({
      placements: uiResult.placements,
      rootId: uiResult.rootId,
      data: this.currentState as Record<string, unknown>,
      title: stepBlock.title,
      formAction,
      formToken,
    });

    const page = await this.pages.create(html);

    // Create webhook registration for form submissions
    // Uses a built-in 'ui-form' webhook slug that the backend knows how to handle
    const webhook: WebhookRegistration = {
      slug: 'ui-form',
      identifier: webhookIdentifier,
      schema: uiConfig.responseSchema ?? z.record(z.unknown()),
      token: formToken,
    };

    // Set currentPage for the next step to access
    this.currentPage = {
      url: page.url,
      webhook,
    };

    // State doesn't change from UI step - it just sets up the page
    // The next step will receive the page object and can use waitFor
    yield* this.completeStep(step, prevState);
  }

  private async *executeWait(
    step: Step,
    waitBlock: WaitBlock<any, any, any, any>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const { steps, options, brainRunId } = this;

    // Emit STEP_START for the wait block
    yield {
      type: BRAIN_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      stepTitle: step.block.title,
      stepId: step.id,
      stepIndex: this.currentStepIndex,
      options,
      brainRunId,
    };

    step.withStatus(STATUS.RUNNING);

    yield {
      type: BRAIN_EVENTS.STEP_STATUS,
      steps: steps.map((s) => {
        const { patch, ...rest } = s.serialized;
        return rest;
      }),
      options,
      brainRunId,
    };

    // Execute the wait action (side effects like notifications happen here)
    const result = await waitBlock.action({
      state: this.currentState,
      options: this.options ?? ({} as TOptions),
      client: this.client,
      resources: this.resources,
      page: this.currentPage,
      pages: this.pages,
      env: this.env,
      ...this.services,
    });

    // Complete step (state unchanged, generates empty patch)
    yield* this.completeStep(step, this.currentState);

    yield {
      type: BRAIN_EVENTS.STEP_STATUS,
      steps: steps.map((s) => {
        const { patch, ...rest } = s.serialized;
        return rest;
      }),
      options,
      brainRunId,
    };

    // Normalize result to array (handle single webhook case)
    const webhooks = Array.isArray(result) ? result : [result];

    // Serialize webhooks (strip Zod schemas)
    const serializedWaitFor: SerializedWebhookRegistration[] = webhooks.map(
      (registration: WebhookRegistration) => ({
        slug: registration.slug,
        identifier: registration.identifier,
        token: registration.token,
      })
    );

    // Emit WEBHOOK event
    yield {
      type: BRAIN_EVENTS.WEBHOOK,
      waitFor: serializedWaitFor,
      options: this.options,
      brainRunId: this.brainRunId,
    };

    // Reset currentPage after wait consumes it (page is ephemeral)
    this.currentPage = undefined;
  }

  private *executeGuard(
    step: Step,
    guard: GuardBlock<any, any>
  ): Generator<BrainEvent<TOptions>> {
    const { steps, options, brainRunId } = this;
    const predicateResult = guard.predicate({ state: this.currentState, options: this.options });

    // Emit STEP_START for the guard
    yield {
      type: BRAIN_EVENTS.STEP_START,
      status: STATUS.RUNNING,
      stepTitle: step.block.title,
      stepId: step.id,
      stepIndex: this.currentStepIndex,
      options,
      brainRunId,
    };

    step.withStatus(STATUS.RUNNING);

    yield {
      type: BRAIN_EVENTS.STEP_STATUS,
      steps: steps.map((s) => {
        const { patch, ...rest } = s.serialized;
        return rest;
      }),
      options,
      brainRunId,
    };

    // Complete the guard step (state unchanged, empty patch)
    yield* this.completeStep(step, this.currentState);

    yield {
      type: BRAIN_EVENTS.STEP_STATUS,
      steps: steps.map((s) => {
        const { patch, ...rest } = s.serialized;
        return rest;
      }),
      options,
      brainRunId,
    };

    this.currentStepIndex++;

    // If predicate is false, skip all remaining steps
    if (!predicateResult) {
      while (this.currentStepIndex < steps.length) {
        const skipStep = steps[this.currentStepIndex];
        skipStep.withStatus(STATUS.HALTED);

        yield {
          type: BRAIN_EVENTS.STEP_COMPLETE,
          status: STATUS.RUNNING,
          stepTitle: skipStep.block.title,
          stepId: skipStep.id,
          patch: [],
          halted: true,
          options,
          brainRunId,
        };

        this.currentStepIndex++;
      }

      yield {
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: steps.map((s) => {
          const { patch, ...rest } = s.serialized;
          return rest;
        }),
        options,
        brainRunId,
      };
    }
  }

  private *completeStep(
    step: Step,
    prevState: TState
  ): Generator<BrainEvent<TOptions>> {
    step.withStatus(STATUS.COMPLETE);

    // Create patch for the state change
    const patch = createPatch(prevState, this.currentState);
    step.withPatch(patch);

    yield {
      type: BRAIN_EVENTS.STEP_COMPLETE,
      status: STATUS.RUNNING,
      stepTitle: step.block.title,
      stepId: step.id,
      patch,
      options: this.options ?? ({} as TOptions),
      brainRunId: this.brainRunId,
    };
  }
}
