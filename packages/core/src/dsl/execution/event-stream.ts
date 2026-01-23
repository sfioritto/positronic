import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator, ToolMessage } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, AgentTool, AgentConfig, AgentToolWaitFor, StepContext } from '../types.js';
import { STATUS, BRAIN_EVENTS } from '../constants.js';
import { createPatch, applyPatches } from '../json-patch.js';
import type { Resources } from '../../resources/resources.js';
import type { WebhookRegistration, SerializedWebhookRegistration } from '../webhook.js';
import type { PagesService } from '../pages.js';
import type { AgentResumeContext } from '../agent-messages.js';
import type { UIComponent } from '../../ui/types.js';
import { generateUI } from '../../ui/generate-ui.js';
import { generatePageHtml } from '../../ui/generate-page-html.js';

import type { BrainEvent } from '../definitions/events.js';
import type { SerializedStep } from '../definitions/steps.js';
import type { Block, StepBlock, BrainBlock, AgentBlock } from '../definitions/blocks.js';
import type { GeneratedPage } from '../definitions/brain-types.js';
import type { InitialRunParams, RerunParams } from '../definitions/run-params.js';

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
  private initialState: TState;
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
  private agentResumeContext: AgentResumeContext | null | undefined = undefined;
  private initialCompletedSteps?: SerializedStep[];
  private components?: Record<string, UIComponent<any>>;
  private defaultTools?: Record<string, AgentTool>;

  constructor(
    params: (InitialRunParams<TOptions> | RerunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
      defaultTools?: Record<string, AgentTool>;
    }
  ) {
    const {
      initialState = {} as TState,
      initialCompletedSteps,
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
      response,
      agentResumeContext,
      components,
      defaultTools,
    } = params as RerunParams<TOptions> & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
      defaultTools?: Record<string, AgentTool>;
    };

    this.initialState = initialState as TState;
    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
    this.pages = pages;
    this.env = env ?? DEFAULT_ENV;
    this.initialCompletedSteps = initialCompletedSteps;
    this.components = components;
    this.defaultTools = defaultTools;
    // Initialize steps array with UUIDs and pending status
    this.steps = blocks.map((block, index) => {
      const completedStep = initialCompletedSteps?.[index];
      if (completedStep) {
        return new Step(block, completedStep.id)
          .withStatus(completedStep.status)
          .withPatch(completedStep.patch);
      }
      return new Step(block);
    });

    this.currentState = clone(this.initialState);

    for (const step of this.steps) {
      if (step.serialized.status === STATUS.COMPLETE && step.serialized.patch) {
        this.currentState = applyPatches(this.currentState, [
          step.serialized.patch,
        ]) as TState;
      }
    }

    // Use provided ID if available, otherwise generate one
    this.brainRunId = providedBrainRunId ?? uuidv4();

    // Set agent resume context if provided (for agent webhook restarts)
    if (agentResumeContext) {
      this.agentResumeContext = agentResumeContext;
      // Note: We intentionally do NOT set currentResponse here.
      // For agent resumption, the webhook response should flow through
      // the messages array (via agentResumeContext), not through the
      // config function's response parameter. The config function is
      // for agent setup, not for processing webhook responses.
    } else if (response) {
      // Set initial response only for non-agent webhook restarts
      this.currentResponse = response;
    }
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
      const hasCompletedSteps = steps.some(
        (step) => step.serialized.status !== STATUS.PENDING
      );
      yield {
        type: hasCompletedSteps ? BRAIN_EVENTS.RESTART : BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle,
        brainDescription,
        // Only include initialState for START events; RESTART reconstructs state from patches
        ...(hasCompletedSteps ? {} : { initialState: currentState }),
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

      // Process each step
      while (this.currentStepIndex < steps.length) {
        const step = steps[this.currentStepIndex];

        // Skip completed steps
        if (step.serialized.status === STATUS.COMPLETE) {
          this.currentStepIndex++;
          continue;
        }
        // Step start event
        yield {
          type: BRAIN_EVENTS.STEP_START,
          status: STATUS.RUNNING,
          stepTitle: step.block.title,
          stepId: step.id,
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
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any, any>;

      // Check if this is a UI step - handle specially
      if (stepBlock.isUIStep) {
        yield* this.executeUIStep(step, stepBlock);
        return;
      }
    }

    if (block.type === 'brain') {
      const brainBlock = block as BrainBlock<any, any, any, TOptions, TServices>;
      const initialState =
        typeof brainBlock.initialState === 'function'
          ? brainBlock.initialState(this.currentState)
          : brainBlock.initialState;

      // Check if this inner brain step has completed inner steps (for resume)
      const stepIndex = this.steps.indexOf(step);
      const completedStepEntry = this.initialCompletedSteps?.[stepIndex];
      const innerCompletedSteps = completedStepEntry?.innerSteps;

      // Run inner brain and yield all its events
      // Pass brainRunId so inner brain shares outer brain's run ID
      // Pass innerSteps and response for resume scenarios
      let patches: any[] = [];

      // If resuming, include patches from already-completed inner steps
      // These won't be re-emitted as STEP_COMPLETE events
      if (innerCompletedSteps) {
        for (const completedStep of innerCompletedSteps) {
          if (completedStep.patch) {
            patches.push(completedStep.patch);
          }
        }
      }

      let innerBrainPaused = false;
      const innerRun = innerCompletedSteps
        ? brainBlock.innerBrain.run({
            resources: this.resources,
            client: this.client,
            initialState,
            initialCompletedSteps: innerCompletedSteps,
            options: this.options ?? ({} as TOptions),
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
            response: this.currentResponse,
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
      const innerState = applyPatches(initialState, patches);

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
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any, any>;

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

      // Extract state from result (handles waitFor and promptResponse cases)
      if (result && typeof result === 'object' && ('waitFor' in result || 'promptResponse' in result)) {
        this.currentState = result.state;
      } else {
        this.currentState = result;
      }
      yield* this.completeStep(step, prevState);

      if (result && typeof result === 'object' && 'waitFor' in result) {
        // Serialize webhook registrations (remove Zod schemas for event serializability)
        const serializedWaitFor: SerializedWebhookRegistration[] = result.waitFor.map(
          (registration: WebhookRegistration) => ({
            slug: registration.slug,
            identifier: registration.identifier,
          })
        );

        yield {
          type: BRAIN_EVENTS.WEBHOOK,
          waitFor: serializedWaitFor,
          options: this.options,
          brainRunId: this.brainRunId,
        };
      }

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

    // Check if we're resuming from a webhook
    let messages: ToolMessage[];
    if (this.agentResumeContext) {
      const resumeContext = this.agentResumeContext;

      // Emit WEBHOOK_RESPONSE event to record the response
      yield {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        response: resumeContext.webhookResponse,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Emit AGENT_TOOL_RESULT for the pending tool (webhook response injected as tool result)
      yield {
        type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
        stepTitle: step.block.title,
        stepId: step.id,
        toolCallId: resumeContext.pendingToolCallId,
        toolName: resumeContext.pendingToolName,
        result: resumeContext.webhookResponse,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Use restored messages from the resume context
      messages = resumeContext.messages;

      // Clear the context so it's only used once
      this.agentResumeContext = undefined;
    } else {
      // Use "Begin." as default prompt if not provided
      const prompt = config.prompt ?? 'Begin.';

      // Emit agent start event (only for fresh starts)
      yield {
        type: BRAIN_EVENTS.AGENT_START,
        stepTitle: step.block.title,
        stepId: step.id,
        prompt,
        system: config.system,
        tools: Object.keys(mergedTools),
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Initialize messages for fresh start
      messages = [{ role: 'user', content: prompt }];
    }

    // Initialize token tracking
    let totalTokens = 0;
    let iteration = 0;
    const maxIterations = config.maxIterations ?? 100;

    // Main agent loop
    while (true) {
      iteration++;

      // Check max iterations limit BEFORE making the LLM call
      if (iteration > maxIterations) {
        yield {
          type: BRAIN_EVENTS.AGENT_ITERATION_LIMIT,
          stepTitle: step.block.title,
          stepId: step.id,
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

RETURNS: { url: string, webhook: { slug: string, identifier: string } | null }
- url: The page URL
- webhook: For forms (hasForm=true), contains slug and identifier that can be passed to waitForWebhook to pause execution until the user submits the form

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
        messages,
        tools: toolsForClient,
      });

      // Track tokens
      const tokensThisIteration = response.usage.totalTokens;
      totalTokens += tokensThisIteration;

      // Emit iteration event (after LLM call so we have token info)
      yield {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        stepTitle: step.block.title,
        stepId: step.id,
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
          stepId: step.id,
          totalTokens,
          maxTokens: config.maxTokens,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        yield* this.completeStep(step, prevState);
        return;
      }

      // Handle assistant text response
      if (response.text) {
        yield {
          type: BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
          stepTitle: step.block.title,
          stepId: step.id,
          content: response.text,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        messages.push({ role: 'assistant', content: response.text });
      }

      // If no tool calls, agent naturally ends
      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield* this.completeStep(step, prevState);
        return;
      }

      // Process tool calls
      for (const toolCall of response.toolCalls) {
        yield {
          type: BRAIN_EVENTS.AGENT_TOOL_CALL,
          stepTitle: step.block.title,
          stepId: step.id,
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
            stepId: step.id,
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
            stepId: step.id,
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

            // Emit agent webhook event first (captures pending tool context)
            yield {
              type: BRAIN_EVENTS.AGENT_WEBHOOK,
              stepTitle: step.block.title,
              stepId: step.id,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.args as JsonObject,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };

            // Then emit webhook event with all webhooks (first response wins)
            yield {
              type: BRAIN_EVENTS.WEBHOOK,
              waitFor: webhooks.map((w) => ({
                slug: w.slug,
                identifier: w.identifier,
              })),
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
            return;
          }

          // Normal tool result
          yield {
            type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
            stepTitle: step.block.title,
            stepId: step.id,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            result: toolResult,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          });
        }
      }
    }
  }

  /**
   * Execute a UI generation step.
   * Generates UI components, renders to HTML, creates page, and sets up webhook.
   */
  private async *executeUIStep(
    step: Step,
    stepBlock: StepBlock<any, any, TOptions, TServices, any, any, any>
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

    // Construct form action URL for the webhook
    const formAction = `${this.env.origin}/webhooks/system/ui-form?identifier=${encodeURIComponent(webhookIdentifier)}`;

    // Generate HTML page
    const html = generatePageHtml({
      placements: uiResult.placements,
      rootId: uiResult.rootId,
      data: this.currentState as Record<string, unknown>,
      title: stepBlock.title,
      formAction,
    });

    const page = await this.pages.create(html);

    // Create webhook registration for form submissions
    // Uses a built-in 'ui-form' webhook slug that the backend knows how to handle
    const webhook: WebhookRegistration = {
      slug: 'ui-form',
      identifier: webhookIdentifier,
      schema: uiConfig.responseSchema ?? z.record(z.unknown()),
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
