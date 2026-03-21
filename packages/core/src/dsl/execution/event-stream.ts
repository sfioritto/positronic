import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type {
  ObjectGenerator,
  ToolMessage,
  ResponseMessage,
} from '../../clients/types.js';
import type {
  State,
  JsonObject,
  RuntimeEnv,
  AgentTool,
  AgentConfig,
  AgentToolWaitFor,
  SignalProvider,
  CurrentUser,
} from '../types.js';
import { STATUS, BRAIN_EVENTS } from '../constants.js';
import { createPatch, applyPatches } from '../json-patch.js';
import { IterateResult } from '../iterate-result.js';
import type { Resources } from '../../resources/resources.js';
import type {
  WebhookRegistration,
  SerializedWebhookRegistration,
  SerializedPageContext,
} from '../webhook.js';
import type { PagesService } from '../pages.js';
import type { UIComponent } from '../../ui/types.js';
import { generatePage } from '../../ui/generate-page.js';
import { generatePageHtml } from '../../ui/generate-page-html.js';
import type { MemoryProvider, ScopedMemory } from '../../memory/types.js';
import { createScopedMemory } from '../../memory/scoped-memory.js';
import type { Store, StoreProvider } from '../../store/types.js';
import type { FilesService } from '../../files/types.js';

import type { BrainEvent } from '../definitions/events.js';
import type {
  Block,
  StepBlock,
  BrainBlock,
  AgentBlock,
  GuardBlock,
  WaitBlock,
  MapBlock,
} from '../definitions/blocks.js';
import type { GeneratedPage } from '../definitions/brain-types.js';
import type {
  ResumeParams,
  InitialRunParams,
  ResumeRunParams,
} from '../definitions/run-params.js';

import { Step } from '../builder/step.js';
import { DEFAULT_ENV, DEFAULT_AGENT_SYSTEM_PROMPT } from './constants.js';
import { resolveTemplate } from '../../template/render.js';

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
  private resume?: ResumeParams;
  private components?: Record<string, UIComponent<any>>;
  private defaultTools?: Record<string, AgentTool<any>>;
  private extraTools?: Record<string, AgentTool<any>>;
  private signalProvider?: SignalProvider;
  private memoryProvider?: MemoryProvider;
  private scopedMemory?: ScopedMemory;
  private store?: Store<any>;
  private storeProvider?: StoreProvider;
  private files?: FilesService;
  private governor?: (client: ObjectGenerator) => ObjectGenerator;
  private currentUser: CurrentUser;
  private guards: Map<number, GuardBlock<any, any>> = new Map();
  private waits: Map<number, WaitBlock<any, any, any, any>> = new Map();
  private stopped = false;
  private optionsSchema?: z.ZodSchema<any>;

  constructor(
    params: (InitialRunParams<TOptions> | ResumeRunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
      defaultTools?: Record<string, AgentTool<any>>;
      extraTools?: Record<string, AgentTool<any>>;
      memoryProvider?: MemoryProvider;
      store?: Store<any>;
      storeProvider?: StoreProvider;
      optionsSchema?: z.ZodSchema<any>;
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
      extraTools,
      signalProvider,
      memoryProvider,
      store,
      storeProvider,
      files,
      currentUser,
    } = params;

    // Store governor for per-step client resolution
    this.governor = (params as any).governor;
    this.currentUser = currentUser;

    // Check if this is a resume run or fresh start
    const resumeParams = params as ResumeRunParams<TOptions>;
    const initialParams = params as InitialRunParams<TOptions>;
    const resume = resumeParams.resume;

    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
    this.pages = pages;
    this.env = env ?? DEFAULT_ENV;
    this.resume = resume;
    this.components = components;
    this.defaultTools = defaultTools;
    this.extraTools = extraTools;
    this.signalProvider = signalProvider;
    this.memoryProvider = memoryProvider;
    this.store = store;
    this.storeProvider = storeProvider;
    this.files = files;
    this.optionsSchema = params.optionsSchema;

    // Create scoped memory if provider is configured
    if (memoryProvider) {
      this.scopedMemory = createScopedMemory(
        memoryProvider,
        title,
        this.currentUser.name
      );
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

    if (resume) {
      // Resume: use state and stepIndex from resume params
      this.currentState = clone(resume.state) as TState;
      this.currentStepIndex = resume.stepIndex;

      // Mark steps before stepIndex as complete (they won't be re-executed)
      for (let i = 0; i < resume.stepIndex; i++) {
        this.steps[i].withStatus(STATUS.COMPLETE);
      }

      // Re-wrap IterateResult instances that were serialized to plain arrays.
      // During suspension, JSON patches call toJSON() on IterateResult, turning
      // them into plain [item, result][] arrays. Re-wrap so downstream steps
      // can use IterateResult methods (.map, .filter, etc.)
      for (let i = 0; i < resume.stepIndex; i++) {
        const block = this.steps[i].block;
        if (block.type === 'map') {
          const mapBlock = block as MapBlock;
          const value = (this.currentState as any)[mapBlock.stateKey];
          if (
            value != null &&
            Array.isArray(value) &&
            !(value instanceof IterateResult)
          ) {
            (this.currentState as any)[mapBlock.stateKey] = new IterateResult(
              value
            );
          }
        }
      }

      // For inner brains (no signalProvider), check for webhookResponse
      // The outer brain will have set this from the signal
      if (!signalProvider && resume.webhookResponse && !resume.agentContext) {
        this.currentResponse = resume.webhookResponse;
      }
      // Agent webhook response is handled via agentContext (checked in executeAgent)

      // Restore page context if available (from a preceding UI step)
      if (resume.currentPage) {
        this.currentPage = resume.currentPage.webhook
          ? {
              url: resume.currentPage.url,
              webhook: {
                ...resume.currentPage.webhook,
                schema: z.record(z.unknown()),
              },
            }
          : { url: resume.currentPage.url };
      }
    } else {
      // Fresh start: use initialState or empty object
      this.currentState = clone(initialParams.initialState ?? {}) as TState;
      this.currentStepIndex = 0;
    }

    // Use provided ID if available, otherwise generate one
    this.brainRunId = providedBrainRunId ?? uuidv4();
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
      if (!this.resume) {
        yield {
          type: BRAIN_EVENTS.START,
          status: STATUS.RUNNING,
          brainTitle,
          brainDescription,
          initialState: currentState,
          options,
          brainRunId,
          currentUser: this.currentUser,
        };

        // Emit initial step status after brain starts
        yield this.stepStatusEvent();

        // Validate options after START so errors are visible in watch/history
        if (this.optionsSchema) {
          this.options = this.optionsSchema.parse(this.options) as TOptions;
        } else if (this.options && Object.keys(this.options).length > 0) {
          throw new Error(
            `Brain '${brainTitle}' received options but no schema was defined. Use withOptionsSchema() to define a schema for options.`
          );
        }
      } else {
        // Resuming - check for WEBHOOK_RESPONSE signal or fall back to stored webhook response
        let webhookResponse: JsonObject | undefined;

        if (this.signalProvider) {
          // Outer brain: consume only WEBHOOK signals at resume start
          // Other signals (USER_MESSAGE, CONTROL) remain in queue for processing in step/agent loops
          const signals = await this.signalProvider.getSignals('WEBHOOK');
          const webhookSignal = signals.find(
            (s) => s.type === 'WEBHOOK_RESPONSE'
          );

          if (webhookSignal && webhookSignal.type === 'WEBHOOK_RESPONSE') {
            webhookResponse = webhookSignal.response;

            // Set currentResponse for step consumption (non-agent webhooks)
            this.currentResponse = webhookResponse;

            // Store for propagation to inner brains and agent context
            if (this.resume) {
              this.resume = { ...this.resume, webhookResponse };
            }
          }
        } else {
          // Inner brain (no signalProvider): check for webhookResponse passed from outer brain
          webhookResponse = this.resume?.webhookResponse;
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
        if (
          step.serialized.status === STATUS.COMPLETE ||
          step.serialized.status === STATUS.HALTED
        ) {
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
        yield this.stepStatusEvent();

        // Execute step and yield the STEP_COMPLETE event and
        // all events from inner brains if any
        yield* this.executeStep(step);

        // Backend requested a stop (e.g. iterate item pause for DO restart)
        if (this.stopped) {
          return;
        }

        // Step Status Event
        yield this.stepStatusEvent();

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
      yield this.stepStatusEvent();

      throw error;
    }
  }

  private stepStatusEvent(): BrainEvent<TOptions> {
    return {
      type: BRAIN_EVENTS.STEP_STATUS,
      steps: this.steps.map((s) => {
        const { patch, ...rest } = s.serialized;
        return rest;
      }),
      options: this.options,
      brainRunId: this.brainRunId,
    };
  }

  private buildStepContext(step: Step) {
    return {
      state: this.currentState,
      options: this.options ?? ({} as TOptions),
      client: this.client,
      resources: this.resources,
      response: this.currentResponse,
      page: this.currentPage,
      pages: this.pages,
      env: this.env,
      memory: this.scopedMemory,
      store: this.store,
      files: this.files,
      currentUser: this.currentUser,
      brainRunId: this.brainRunId,
      stepId: step.id,
      ...this.services,
    };
  }

  private async *executeStep(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as Block<any, any, TOptions, TServices, any, any>;

    if (block.type === 'step') {
      const stepBlock = block as StepBlock<
        any,
        any,
        TOptions,
        TServices,
        any,
        any
      >;

      // Check if this is a page step - handle specially
      if (stepBlock.isPageStep) {
        yield* this.executePageStep(step, stepBlock);
        return;
      }
    }

    if (block.type === 'map') {
      yield* this.executeMap(step);
      return;
    }

    if (block.type === 'brain') {
      const brainBlock = block as BrainBlock<
        any,
        any,
        any,
        TOptions,
        TServices
      >;
      const initialState = brainBlock.initialState
        ? typeof brainBlock.initialState === 'function'
          ? brainBlock.initialState(this.buildStepContext(step))
          : brainBlock.initialState
        : {};

      const innerOptions = brainBlock.options
        ? typeof brainBlock.options === 'function'
          ? brainBlock.options(this.buildStepContext(step))
          : brainBlock.options
        : {};

      // Check if we're resuming an inner brain
      const innerStack = this.resume?.innerStack;
      const hasInnerResume = innerStack && innerStack.length > 0;
      const innerEntry = hasInnerResume ? innerStack[0] : undefined;
      const remainingStack = hasInnerResume ? innerStack.slice(1) : undefined;

      // Run inner brain and yield all its events
      // Pass brainRunId so inner brain shares outer brain's run ID
      let patches: any[] = [];

      let innerBrainPaused = false;
      const innerRun = hasInnerResume
        ? brainBlock.innerBrain.run({
            resources: this.resources,
            client: this.client,
            currentUser: this.currentUser,
            resume: {
              ...this.resume,
              state: innerEntry!.state,
              stepIndex: innerEntry!.stepIndex,
              innerStack: remainingStack?.length ? remainingStack : undefined,
            },
            options: innerOptions,
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
            governor: this.governor,
            services: this.services as Record<string, any>,
            storeProvider: this.storeProvider,
            files: this.files,
          })
        : brainBlock.innerBrain.run({
            resources: this.resources,
            client: this.client,
            currentUser: this.currentUser,
            initialState,
            options: innerOptions,
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
            governor: this.governor,
            services: this.services as Record<string, any>,
            storeProvider: this.storeProvider,
            files: this.files,
          });

      // Context has been forwarded to the inner brain — clear so outer
      // brain's later steps (e.g. an agent at step N+1) don't consume them.
      if (hasInnerResume) {
        this.resume = undefined;
      }

      // Track nesting depth so we only collect patches from the direct
      // child brain (depth 1) and ignore patches from deeper nested brains
      // (e.g. inner brains run by .map() or nested .brain() steps).
      // Resumed brains skip their START event, so start at depth 1.
      let innerDepth = hasInnerResume ? 1 : 0;

      for await (const event of innerRun) {
        yield event; // Forward all inner brain events
        if (event.type === BRAIN_EVENTS.START) {
          innerDepth++;
        }
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE && innerDepth === 1) {
          patches.push(event.patch);
        }
        // If inner brain yielded a WEBHOOK event, it's pausing
        if (event.type === BRAIN_EVENTS.WEBHOOK) {
          innerBrainPaused = true;
        }
        if (event.type === BRAIN_EVENTS.COMPLETE) {
          innerDepth--;
          if (innerDepth === 0) {
            break;
          }
        }
        // Errored brains emit ERROR instead of COMPLETE, so decrement depth
        // to keep tracking accurate when errors are caught (e.g. by .map() error handlers)
        if (event.type === BRAIN_EVENTS.ERROR) {
          innerDepth--;
        }
      }

      // If inner brain paused for webhook, don't complete the outer brain step
      // The outer brain should also pause
      if (innerBrainPaused) {
        return;
      }

      // Apply collected patches to get final inner state
      // When resuming, use the resumed state as base; otherwise use initialState
      const baseState = innerEntry?.state ?? initialState;
      const innerState = applyPatches(baseState, patches);

      // Get previous state before action
      const prevState = this.currentState;

      // Spread inner brain's final state onto outer state
      this.currentState = {
        ...this.currentState,
        ...innerState,
      };
      yield* this.completeStep(step, prevState);
    } else if (block.type === 'agent') {
      const prevState = this.currentState;
      yield* this.executeAgent(step);
      yield* this.completeStep(step, prevState);
    } else {
      // Get previous state before action
      const prevState = this.currentState;
      const stepBlock = block as StepBlock<
        any,
        any,
        TOptions,
        TServices,
        any,
        any
      >;

      // Resolve per-step client: if the step has an override, apply governor to it;
      // otherwise use the default (already-governed) client
      const stepClient = stepBlock.client
        ? this.governor
          ? this.governor(stepBlock.client)
          : stepBlock.client
        : this.client;

      const result = await Promise.resolve(
        stepBlock.action({
          ...this.buildStepContext(step),
          client: stepClient,
        })
      );

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

  private async *executeAgent(
    step: Step
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as AgentBlock<
      any,
      any,
      TOptions,
      TServices,
      any,
      any
    >;
    const prevState = this.currentState;

    // Combine default tools and extra tools for injection into configFn
    const allTools: Record<string, AgentTool<any>> = {
      ...(this.defaultTools ?? {}),
      ...(this.extraTools ?? {}),
    };
    const components = this.components ?? {};

    // Get agent configuration - inject tools and components
    const config = await block.configFn({
      ...this.buildStepContext(step),
      tools: allTools,
      components,
    });

    // Reset currentPage after configFn consumes it (page is ephemeral)
    this.currentPage = undefined;

    // Merge tools: step tools override defaults + extras
    const mergedTools: Record<string, AgentTool<any>> = {
      ...allTools,
      ...(config.tools ?? {}),
    };

    // Generate a 'done' terminal tool for every agent using the required outputSchema
    const schema = config.outputSchema;
    mergedTools['done'] = {
      description: `Signal that the task is complete and provide the final result.

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

The output must conform to the provided schema.`,
      inputSchema: schema,
      terminal: true,
    };

    // Track conversation using SDK-native messages (preserves providerOptions like thoughtSignature)
    let responseMessages: ResponseMessage[] | undefined;
    // Initial messages for first call (will be converted by client)
    let initialMessages: ToolMessage[];

    // Check if we're resuming from a previous agent execution
    const agentContext = this.resume?.agentContext;
    const webhookResponse = this.resume?.webhookResponse;

    // Use preserved stepId from agentContext when resuming, or step.id for fresh start
    // This ensures all events for the same agent use the same stepId across resumes
    const effectiveStepId = agentContext?.stepId ?? step.id;

    // Resolve JSX templates for system prompt once (used in both fresh and loop paths)
    const resolvedSystem = config.system
      ? await resolveTemplate(config.system)
      : undefined;

    if (agentContext) {
      // Check if this is a webhook resume (has webhook response) or pause resume
      if (
        webhookResponse &&
        agentContext.pendingToolCallId &&
        agentContext.pendingToolName
      ) {
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
        const userMessage: ResponseMessage = {
          role: 'user',
          content: agentContext.prompt,
        };

        if (this.client.createToolResultMessage) {
          const toolResultMessage = this.client.createToolResultMessage(
            agentContext.pendingToolCallId,
            agentContext.pendingToolName,
            webhookResponse
          );

          responseMessages = [
            userMessage,
            ...agentContext.responseMessages,
            toolResultMessage,
          ];

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

        const userMessage: ResponseMessage = {
          role: 'user',
          content: agentContext.prompt,
        };
        responseMessages = [userMessage, ...agentContext.responseMessages];
        initialMessages = [];

        // No events to emit for pause resume - we just continue the conversation
      }

      // Clear resume so it's only used once
      this.resume = undefined;
    } else {
      // Use "Begin." as default prompt if not provided, resolve JSX templates
      const prompt = await resolveTemplate(config.prompt ?? 'Begin.');

      // Emit agent start event (only for fresh starts)
      yield {
        type: BRAIN_EVENTS.AGENT_START,
        stepTitle: step.block.title,
        stepId: effectiveStepId,
        prompt,
        system: resolvedSystem,
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
            const userMessage: ResponseMessage = {
              role: 'user',
              content: signal.content,
            };
            if (responseMessages) {
              responseMessages = [...responseMessages, userMessage];
            } else {
              initialMessages = [
                ...initialMessages,
                { role: 'user', content: signal.content },
              ];
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
        throw new Error(
          `Agent hit iteration limit (${maxIterations}) without producing required 'done' output`
        );
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

        // Enrich generatePage description with available component information
        if (
          name === 'generatePage' &&
          components &&
          Object.keys(components).length > 0
        ) {
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
      const systemPrompt = resolvedSystem
        ? `${DEFAULT_AGENT_SYSTEM_PROMPT}\n\n${resolvedSystem}`
        : DEFAULT_AGENT_SYSTEM_PROMPT;

      const response = await this.client.generateText({
        system: systemPrompt,
        messages: initialMessages,
        responseMessages,
        tools: toolsForClient,
        toolChoice: config.toolChoice ?? 'required',
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
        throw new Error(
          `Agent hit token limit (${config.maxTokens}) without producing required 'done' output`
        );
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

      // If no tool calls, something went wrong — with toolChoice 'required',
      // the LLM should always produce tool calls. If it didn't, the agent
      // exited without calling the 'done' tool to produce required output.
      if (!response.toolCalls || response.toolCalls.length === 0) {
        throw new Error(
          `Agent exited without calling the 'done' tool. The LLM returned no tool calls despite toolChoice being 'required'. This is unexpected — the agent must call 'done' to produce its output.`
        );
      }

      // Track pending webhook if any tool returns waitFor
      // We process ALL tool calls first, then pause for webhook at the end
      let pendingWebhook: {
        toolCallId: string;
        toolName: string;
        input: JsonObject;
        webhooks: Array<{ slug: string; identifier: string }>;
        timeout?: number;
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
          if (toolCall.toolName === 'done') {
            const parsed = config.outputSchema!.safeParse(toolCall.args);
            if (!parsed.success) {
              throw new Error(
                `Agent output does not match outputSchema: ${parsed.error.message}`
              );
            }
            // Spread result onto state
            this.currentState = {
              ...this.currentState,
              ...parsed.data,
            };
          } else {
            // Default behavior: spread into state root (for other terminal tools)
            this.currentState = {
              ...this.currentState,
              ...(toolCall.args as JsonObject),
            };
          }
          return;
        }

        if (tool.execute) {
          const toolContext = {
            state: this.currentState,
            options: this.options ?? ({} as JsonObject),
            client: this.client,
            resources: this.resources,
            response: this.currentResponse,
            page: this.currentPage,
            pages: this.pages!,
            env: this.env,
            components: this.components,
            brainRunId: this.brainRunId,
            stepId: effectiveStepId,
            memory: this.scopedMemory,
            store: this.store,
            currentUser: this.currentUser,
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
              timeout: waitForResult.timeout,
            };

            // Emit tool result event for debugging/visibility (with pending status)
            yield {
              type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
              stepTitle: step.block.title,
              stepId: effectiveStepId,
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              result: {
                status: 'waiting_for_webhook',
                webhooks: pendingWebhook.webhooks,
              },
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
                {
                  status: 'waiting_for_webhook',
                  webhooks: pendingWebhook.webhooks,
                }
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
          ...(pendingWebhook.timeout !== undefined && {
            timeout: pendingWebhook.timeout,
          }),
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        return;
      }
    }
  }

  /**
   * Execute a map step. Runs the inner brain once per item
   * from the `over` list, collects [item, innerState] tuples under `outputKey`.
   */
  private async *executeMap(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as MapBlock;
    const prevState = this.currentState;
    const config = await block.configFn(this.buildStepContext(step));
    const items = await config.over;
    const totalItems = items.length;

    // Resume support
    const iterateProgress = this.resume?.iterateProgress;
    const startIndex = iterateProgress?.processedCount ?? 0;
    const resultsMap = new Map<number, [any, any]>();
    if (iterateProgress?.accumulatedResults) {
      for (let k = 0; k < iterateProgress.accumulatedResults.length; k++) {
        const r = iterateProgress.accumulatedResults[k];
        if (r != null) resultsMap.set(k, r);
      }
    }

    if (iterateProgress) {
      this.resume = undefined;
    }

    for (let i = startIndex; i < totalItems; i++) {
      // Check signals before each item
      if (this.signalProvider) {
        const signals = await this.signalProvider.getSignals('CONTROL');
        for (const signal of signals) {
          if (signal.type === 'KILL') {
            this.stopped = true;
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
            this.stopped = true;
            return;
          }
        }
      }

      const item = items[i];
      let result: [any, any] | undefined;

      try {
        if (config.prompt) {
          // Prompt mode: call generateObject directly per item
          const prompt = await resolveTemplate(config.prompt.message(item));
          const client = config.client
            ? this.governor
              ? this.governor(config.client)
              : config.client
            : this.client;
          const response = await client.generateObject({
            schema: config.prompt.outputSchema,
            prompt,
          });
          result = [item, response.object];
        } else {
          // Brain mode: run inner brain per item
          const initialState = config.initialState!(item);

          const mapInnerOptions = config.options ?? {};

          const innerRun = config.run.run({
            resources: this.resources,
            client: this.client,
            currentUser: this.currentUser,
            initialState,
            options: mapInnerOptions,
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
            governor: this.governor,
            services: this.services as Record<string, any>,
            storeProvider: this.storeProvider,
            files: this.files,
          });

          let patches: any[] = [];
          for await (const event of innerRun) {
            // Throw on WEBHOOK — not supported in map
            if (event.type === BRAIN_EVENTS.WEBHOOK) {
              throw new Error(
                `Webhook/wait inside .map() is not supported. ` +
                  `Step "${block.title}" item ${i} triggered a webhook. ` +
                  `Remove .wait() from the inner brain or process items outside of .map().`
              );
            }
            yield event; // Forward all inner events
            if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
              patches.push(event.patch);
            }
            if (event.type === BRAIN_EVENTS.COMPLETE) {
              break;
            }
          }

          const innerState = applyPatches(initialState, patches);
          result = [item, innerState];
        }
      } catch (error) {
        if (config.error) {
          const fallback = config.error(item, error as Error);
          result = fallback !== null ? [item, fallback] : undefined;
        } else {
          throw error;
        }
      }

      if (result != null) {
        resultsMap.set(i, result);
      }

      yield {
        type: BRAIN_EVENTS.ITERATE_ITEM_COMPLETE,
        stepTitle: step.block.title,
        stepId: step.id,
        itemIndex: i,
        item,
        result: result ? result[1] : undefined,
        processedCount: i + 1,
        totalItems,
        stateKey: block.stateKey,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
        canRelease: !!this.signalProvider,
      };
    }

    const finalResults = new IterateResult([...resultsMap.values()]);
    this.currentState = {
      ...this.currentState,
      [block.stateKey]: finalResults,
    };
    yield* this.completeStep(step, prevState);
  }

  /**
   * Execute a page generation step.
   * Generates UI components, renders to HTML, creates page, and sets up webhook.
   */
  private async *executePageStep(
    step: Step,
    stepBlock: StepBlock<any, any, TOptions, TServices, any, any>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const prevState = this.currentState;
    const pageConfigFn = stepBlock.pageConfigFn!;
    const pageConfig = await pageConfigFn(this.buildStepContext(step));

    // Resume path: form response already available, spread onto state and complete
    if (this.currentResponse && pageConfig.formSchema) {
      this.currentState = {
        ...this.currentState,
        ...this.currentResponse,
      };
      this.currentResponse = undefined;
      yield* this.completeStep(step, prevState);
      return;
    }

    // Validate required configuration
    if (!this.components) {
      throw new Error(
        `Page step "${stepBlock.title}" requires components to be configured via brain.withComponents()`
      );
    }
    if (!this.pages) {
      throw new Error(
        `Page step "${stepBlock.title}" requires pages service to be configured`
      );
    }

    const prompt = await resolveTemplate(pageConfig.prompt);
    const data = (pageConfig.props ?? {}) as Record<string, unknown>;

    const uiResult = await generatePage({
      client: this.client,
      prompt,
      components: this.components,
      schema: pageConfig.formSchema,
      data,
    });

    if (!uiResult.rootId) {
      const placementCount = uiResult.placements.length;
      const placementInfo = uiResult.placements
        .map((p) => `${p.component}(parentId: ${p.parentId ?? 'null'})`)
        .join(', ');

      if (placementCount === 0) {
        throw new Error(
          `Page generation failed for step "${stepBlock.title}" - no components were placed. ` +
            `The LLM may not have called any component tools. ` +
            `LLM response text: ${uiResult.text ?? '(none)'}`
        );
      } else {
        throw new Error(
          `Page generation failed for step "${stepBlock.title}" - no root component found. ` +
            `${placementCount} component(s) were placed but all have a parentId: [${placementInfo}]. ` +
            `The first component should be placed without a parentId to serve as the root.`
        );
      }
    }

    const pageCreateOptions = {
      persist: pageConfig.persist ?? (pageConfig.ttl ? true : false),
      ttl: pageConfig.ttl,
    };

    if (pageConfig.formSchema) {
      // Form page: create webhook, CSRF token, suspend for submission
      const webhookIdentifier = `${this.brainRunId}-${step.id}`;
      const formToken = crypto.randomUUID();
      const formAction = `${
        this.env.origin
      }/webhooks/system/page-form?identifier=${encodeURIComponent(
        webhookIdentifier
      )}&token=${encodeURIComponent(formToken)}`;

      const html = generatePageHtml({
        placements: uiResult.placements,
        rootId: uiResult.rootId,
        data,
        title: stepBlock.title,
        formAction,
      });

      const page = await this.pages.create(html, pageCreateOptions);

      const webhook: WebhookRegistration = {
        slug: 'page-form',
        identifier: webhookIdentifier,
        schema: pageConfig.formSchema,
        token: formToken,
      };

      this.currentPage = { url: page.url, webhook };

      if (pageConfig.onCreated) {
        await pageConfig.onCreated(this.currentPage);
      }

      // Suspend — step completes on resume (see resume path above)
      yield {
        type: BRAIN_EVENTS.WEBHOOK,
        waitFor: [
          {
            slug: webhook.slug,
            identifier: webhook.identifier,
            token: webhook.token,
          },
        ],
        options: this.options,
        brainRunId: this.brainRunId,
      };
      this.currentPage = undefined;
    } else {
      // Read-only page: no form, no webhook
      const html = generatePageHtml({
        placements: uiResult.placements,
        rootId: uiResult.rootId,
        data,
        title: stepBlock.title,
      });

      const page = await this.pages.create(html, pageCreateOptions);

      if (pageConfig.onCreated) {
        await pageConfig.onCreated({ url: page.url });
      }

      yield* this.completeStep(step, prevState, { url: page.url });
    }
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

    yield this.stepStatusEvent();

    // Execute the wait action (side effects like notifications happen here)
    const result = await waitBlock.action(this.buildStepContext(step));

    // Complete step (state unchanged, generates empty patch)
    yield* this.completeStep(step, this.currentState);

    yield this.stepStatusEvent();

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
      ...(waitBlock.timeout !== undefined && { timeout: waitBlock.timeout }),
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
    const predicateResult = guard.predicate(this.buildStepContext(step));

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

    yield this.stepStatusEvent();

    // Complete the guard step (state unchanged, empty patch)
    yield* this.completeStep(step, this.currentState);

    yield this.stepStatusEvent();

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

      yield this.stepStatusEvent();
    }
  }

  private *completeStep(
    step: Step,
    prevState: TState,
    pageContext?: SerializedPageContext
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
      ...(pageContext && { pageContext }),
      options: this.options ?? ({} as TOptions),
      brainRunId: this.brainRunId,
    };
  }
}
