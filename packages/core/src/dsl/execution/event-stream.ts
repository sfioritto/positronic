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
  SignalProvider,
  CurrentUser,
  ToolWaitFor,
  StepContext,
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
import { guessMimeType } from '../../files/mime.js';
import { EventChannel } from './event-channel.js';
import { wrapFilesWithEvents } from '../../files/event-wrapper.js';

import type { BrainEvent } from '../definitions/events.js';
import type {
  Block,
  StepBlock,
  BrainBlock,
  GuardBlock,
  WaitBlock,
  MapBlock,
  PromptBlock,
  PromptConfig,
} from '../definitions/blocks.js';
import type { GeneratedPage } from '../definitions/brain-types.js';
import type {
  ResumeParams,
  InitialRunParams,
  ResumeRunParams,
} from '../definitions/run-params.js';

import { Step } from '../builder/step.js';
import { DEFAULT_ENV } from './constants.js';
import {
  resolveTemplate,
  buildTemplateContext,
  type TemplateContext,
} from '../../template/render.js';

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
  private signalProvider?: SignalProvider;
  private memoryProvider?: MemoryProvider;
  private scopedMemory?: ScopedMemory;
  private store?: Store<any>;
  private storeProvider?: StoreProvider;
  private files?: FilesService;
  private templateContext: TemplateContext;
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
    this.signalProvider = signalProvider;
    this.memoryProvider = memoryProvider;
    this.store = store;
    this.storeProvider = storeProvider;
    this.files = files;
    this.templateContext = buildTemplateContext(this.files, this.resources);
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
      if (!signalProvider && resume.webhookResponse) {
        this.currentResponse = resume.webhookResponse;
      }

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
          // Other signals (CONTROL) remain in queue for processing in step loops
          const signals = await this.signalProvider.getSignals('WEBHOOK');
          const webhookSignal = signals.find(
            (s) => s.type === 'WEBHOOK_RESPONSE'
          );

          if (webhookSignal && webhookSignal.type === 'WEBHOOK_RESPONSE') {
            webhookResponse = webhookSignal.response;

            // Set currentResponse for step consumption
            this.currentResponse = webhookResponse;

            // Store for propagation to inner brains
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

    if (block.type === 'prompt') {
      yield* this.executePrompt(step);
      return;
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
      // brain's later steps don't consume them.
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

      // Event channel lets file operations (and potentially other services)
      // emit events mid-step. The race loop yields them as they arrive.
      // If no events are pushed, the loop resolves immediately with the step.
      const channel = new EventChannel<BrainEvent>();
      const context = this.buildStepContext(step);
      const wrappedFiles = this.files
        ? wrapFilesWithEvents(this.files, channel, {
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
            stepTitle: stepBlock.title,
          })
        : undefined;

      let stepDone = false;
      let stepResult: any;
      let stepError: any;

      const stepPromise = Promise.resolve(
        stepBlock.action({
          ...context,
          client: stepClient,
          ...(wrappedFiles && { files: wrappedFiles }),
        })
      ).then(
        (r) => {
          stepDone = true;
          stepResult = r;
        },
        (e) => {
          stepDone = true;
          stepError = e;
        }
      );

      while (!stepDone) {
        await Promise.race([stepPromise, channel.wait()]);
        for (const event of channel.drain()) {
          yield event as BrainEvent<TOptions>;
        }
      }
      for (const event of channel.drain()) {
        yield event as BrainEvent<TOptions>;
      }

      if (stepError) throw stepError;
      const result = stepResult;

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

  /**
   * Execute a prompt step. Either single-shot (generateObject) or
   * iterative tool-calling loop (generateText) when `loop` is present.
   */
  private async *executePrompt(
    step: Step
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as PromptBlock;
    const prevState = clone(this.currentState);
    const config: PromptConfig = await block.configFn(
      this.buildStepContext(step)
    );

    const client = config.client
      ? this.governor
        ? this.governor(config.client)
        : config.client
      : this.client;

    const prompt = await resolveTemplate(config.message, this.templateContext);

    const system = config.system
      ? await resolveTemplate(config.system, this.templateContext)
      : undefined;

    if (!config.loop) {
      // Single-shot: call generateObject (same behavior as before)
      const attachments = config.attachments
        ? await Promise.all(
            config.attachments.map(async (handle) => ({
              name: handle.name,
              mimeType: guessMimeType(handle.name),
              data: await handle.readBytes(),
            }))
          )
        : undefined;
      const result = await client.generateObject({
        schema: config.outputSchema,
        prompt,
        system,
        attachments,
      });
      this.currentState = { ...this.currentState, ...result.object } as TState;
      yield* this.completeStep(step, prevState);
      return;
    }

    // Loop path: tool-calling iteration
    const {
      tools: userTools,
      maxIterations = 100,
      maxTokens,
      toolChoice = 'required',
    } = config.loop;

    if (!client.generateText) {
      throw new Error(
        `Client does not support generateText, required for prompt loop in step "${block.title}"`
      );
    }
    if (!client.createToolResultMessage) {
      throw new Error(
        `Client does not support createToolResultMessage, required for prompt loop in step "${block.title}"`
      );
    }

    // Build tool definitions for the LLM (description + inputSchema only)
    const toolDefs: Record<
      string,
      { description: string; inputSchema: z.ZodSchema }
    > = {};
    for (const [name, tool] of Object.entries(userTools)) {
      toolDefs[name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    }

    // Auto-generate 'done' tool from outputSchema
    toolDefs['done'] = {
      description: `Signal that the task is complete and provide the final result.

This is a TERMINAL tool - calling it immediately ends execution.
No further tools will execute after this. No further iterations will occur.
The input you provide becomes the final output.

Call this when you have completed the assigned task and have the final answer ready.
Do NOT call if you still need to gather more information.

The output must conform to the provided schema.`,
      inputSchema: config.outputSchema,
    };

    const stepId = step.id;
    const stepTitle = block.title;

    // Emit PROMPT_START
    yield {
      type: BRAIN_EVENTS.PROMPT_START,
      stepTitle,
      stepId,
      prompt,
      system: system,
      tools: Object.keys(toolDefs),
      options: this.options ?? ({} as TOptions),
      brainRunId: this.brainRunId,
    };

    // Conversation state
    const initialMessages: ToolMessage[] = [{ role: 'user', content: prompt }];
    let responseMessages: ResponseMessage[] | undefined;
    let totalTokens = 0;
    let iteration = 0;

    while (true) {
      iteration++;

      // Check iteration limit before LLM call
      if (iteration > maxIterations) {
        yield {
          type: BRAIN_EVENTS.PROMPT_ITERATION_LIMIT,
          stepTitle,
          stepId,
          totalIterations: iteration - 1,
          maxIterations,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        throw new Error(
          `Iteration limit (${maxIterations}) reached in prompt loop "${stepTitle}"`
        );
      }

      // Check signals
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
            yield {
              type: BRAIN_EVENTS.PAUSED,
              status: STATUS.PAUSED,
              brainTitle: this.title,
              brainDescription: this.description,
              brainRunId: this.brainRunId,
              options: this.options ?? ({} as TOptions),
            };
            return;
          }
        }
      }

      // Call LLM
      const llmResult = await client.generateText!({
        system: system,
        messages: iteration === 1 ? initialMessages : [],
        responseMessages,
        tools: toolDefs,
        toolChoice,
      });

      const tokensThisIteration = llmResult.usage.totalTokens;
      totalTokens += tokensThisIteration;
      responseMessages = llmResult.responseMessages;

      // Emit raw response message for replay
      yield {
        type: BRAIN_EVENTS.PROMPT_RAW_RESPONSE_MESSAGE,
        stepTitle,
        stepId,
        iteration,
        message: llmResult.responseMessages,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Emit iteration event
      yield {
        type: BRAIN_EVENTS.PROMPT_ITERATION,
        stepTitle,
        stepId,
        iteration,
        tokensThisIteration,
        totalTokens,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Check token limit
      if (maxTokens && totalTokens >= maxTokens) {
        yield {
          type: BRAIN_EVENTS.PROMPT_TOKEN_LIMIT,
          stepTitle,
          stepId,
          totalTokens,
          maxTokens,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        throw new Error(
          `Token limit (${maxTokens}) reached in prompt loop "${stepTitle}"`
        );
      }

      // Emit assistant text if any
      if (llmResult.text) {
        yield {
          type: BRAIN_EVENTS.PROMPT_ASSISTANT_MESSAGE,
          stepTitle,
          stepId,
          text: llmResult.text,
          iteration,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
      }

      // Check tool calls
      if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
        if (toolChoice === 'required') {
          throw new Error(
            `LLM did not call any tools with toolChoice 'required' in step "${stepTitle}"`
          );
        }
        continue;
      }

      // Process tool calls sequentially
      let pendingWebhook: {
        toolCallId: string;
        toolName: string;
        input: unknown;
        waitFor: ToolWaitFor;
      } | null = null;

      for (const toolCall of llmResult.toolCalls) {
        const { toolCallId, toolName, args } = toolCall;

        // Emit tool call event
        yield {
          type: BRAIN_EVENTS.PROMPT_TOOL_CALL,
          stepTitle,
          stepId,
          toolName,
          toolCallId,
          input: args,
          iteration,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        // Handle 'done' tool
        if (toolName === 'done') {
          const parsed = config.outputSchema.safeParse(args);
          if (!parsed.success) {
            // Feed validation error back to LLM so it can retry
            const errorMsg = `Invalid output: ${parsed.error.message}. Please fix and try again.`;
            const toolResultMsg = client.createToolResultMessage!(
              toolCallId,
              'done',
              errorMsg
            );
            responseMessages = [...(responseMessages ?? []), toolResultMsg];
            yield {
              type: BRAIN_EVENTS.PROMPT_TOOL_RESULT,
              stepTitle,
              stepId,
              toolName: 'done',
              toolCallId,
              result: errorMsg,
              iteration,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
            break; // Break to next iteration so LLM can retry
          }

          // Valid output — merge onto state and complete
          this.currentState = {
            ...this.currentState,
            ...parsed.data,
          } as TState;

          yield {
            type: BRAIN_EVENTS.PROMPT_TOOL_RESULT,
            stepTitle,
            stepId,
            toolName: 'done',
            toolCallId,
            result: parsed.data,
            iteration,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          yield {
            type: BRAIN_EVENTS.PROMPT_COMPLETE,
            stepTitle,
            stepId,
            result: parsed.data,
            terminalTool: 'done',
            totalIterations: iteration,
            totalTokens,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          yield* this.completeStep(step, prevState);
          return;
        }

        // Handle user-defined tools
        const tool = userTools[toolName];
        if (!tool) {
          throw new Error(
            `Unknown tool "${toolName}" called in step "${stepTitle}"`
          );
        }

        // Check for other terminal tools
        if (tool.terminal) {
          this.currentState = {
            ...this.currentState,
            ...(args as Record<string, unknown>),
          } as TState;

          yield {
            type: BRAIN_EVENTS.PROMPT_TOOL_RESULT,
            stepTitle,
            stepId,
            toolName,
            toolCallId,
            result: args,
            iteration,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          yield {
            type: BRAIN_EVENTS.PROMPT_COMPLETE,
            stepTitle,
            stepId,
            result: args,
            terminalTool: toolName,
            totalIterations: iteration,
            totalTokens,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          yield* this.completeStep(step, prevState);
          return;
        }

        // Execute non-terminal tool
        let toolResult: unknown;
        if (tool.execute) {
          toolResult = await tool.execute(
            args,
            this.buildStepContext(step) as StepContext
          );

          // Check for webhook suspension
          if (
            toolResult &&
            typeof toolResult === 'object' &&
            'waitFor' in toolResult
          ) {
            pendingWebhook = {
              toolCallId,
              toolName,
              input: args,
              waitFor: toolResult as ToolWaitFor,
            };

            // Emit tool result with waiting status
            yield {
              type: BRAIN_EVENTS.PROMPT_TOOL_RESULT,
              stepTitle,
              stepId,
              toolName,
              toolCallId,
              result: 'Waiting for webhook response...',
              iteration,
              status: 'waiting_for_webhook' as const,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };

            // Add placeholder to conversation
            const placeholderMsg = client.createToolResultMessage!(
              toolCallId,
              toolName,
              'Waiting for webhook response...'
            );
            responseMessages = [...(responseMessages ?? []), placeholderMsg];

            // Continue processing remaining tool calls in this iteration
            continue;
          }
        } else {
          toolResult = { success: true };
        }

        // Feed tool result back to LLM
        const toolResultMsg = client.createToolResultMessage!(
          toolCallId,
          toolName,
          toolResult
        );
        responseMessages = [...(responseMessages ?? []), toolResultMsg];

        yield {
          type: BRAIN_EVENTS.PROMPT_TOOL_RESULT,
          stepTitle,
          stepId,
          toolName,
          toolCallId,
          result: toolResult,
          iteration,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
      }

      // After all tool calls: if pending webhook, suspend
      if (pendingWebhook) {
        const { waitFor: toolWaitFor } = pendingWebhook;
        const webhooks = Array.isArray(toolWaitFor.waitFor)
          ? toolWaitFor.waitFor
          : [toolWaitFor.waitFor];

        const serializedWaitFor: SerializedWebhookRegistration[] = webhooks.map(
          (registration: WebhookRegistration) => ({
            slug: registration.slug,
            identifier: registration.identifier,
            token: registration.token,
          })
        );

        // Emit prompt-level webhook event
        yield {
          type: BRAIN_EVENTS.PROMPT_WEBHOOK,
          stepTitle,
          stepId,
          toolCallId: pendingWebhook.toolCallId,
          toolName: pendingWebhook.toolName,
          input: pendingWebhook.input,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        // Emit brain-level webhook event (triggers state machine transition to waiting)
        yield {
          type: BRAIN_EVENTS.WEBHOOK,
          waitFor: serializedWaitFor,
          ...(toolWaitFor.timeout !== undefined && {
            timeout: toolWaitFor.timeout,
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
          const prompt = await resolveTemplate(
            config.prompt.message(item),
            this.templateContext
          );
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

    const prompt = await resolveTemplate(
      pageConfig.prompt,
      this.templateContext
    );
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
