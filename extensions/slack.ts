import { Workflow, type Expand, type Context } from "../dsl/blocks";

export type ExtensionMethods<
  TExtension extends Record<string, any>,
  TOptions extends object,
  TContext extends Context
> = {
  [K in keyof TExtension]: TExtension[K] extends (
    this: any,
    title: string,
    config: infer TConfig
  ) => Workflow<any, infer TReturnContext>
    ? (
        title: string,
        config: TConfig extends ((ctx: any) => any)
          ? { [P in keyof TConfig]: TConfig[P] extends Function ? ((ctx: TContext) => any) : TConfig[P] }
          : TConfig
      ) => Workflow<TOptions, Expand<TContext & TReturnContext>>
    : never;
};

export function createWorkflowExtension<
  TExtensionKey extends string,
  TExtension extends Record<string, any>
>(key: TExtensionKey, extension: TExtension) {
  return {
    install() {
      Object.assign(Workflow.prototype, {
        [key]: Object.fromEntries(
          Object.entries(extension).map(([methodKey, fn]) => [
            methodKey,
            fn.bind(Workflow.prototype)
          ])
        )
      });
    },
    augment<TOptions extends object, TContext extends Context>(): ExtensionMethods<TExtension, TOptions, TContext> {
      return {} as ExtensionMethods<TExtension, TOptions, TContext>;
    }
  };
}

export interface SlackMessage extends Context {
  channel: string;
  message: string;
  timestamp: string;
}

export interface SlackNotification extends Context {
  users: string[];
  message: string;
  timestamp: string;
}

const slackExtension = createWorkflowExtension('slack', {
  message(
    this: Workflow<any>,
    title: string,
    config: {
      channel: string;
      message: string | ((ctx: any) => string);
    }
  ) {
    return this.step(title, async ({ context }) => {
      const messageText = typeof config.message === 'function'
        ? config.message(context)
        : config.message;

      console.log(`[SLACK] Sending message to ${config.channel}: ${messageText}`);

      // Simulate sending message
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        ...context,
        lastSlackMessage: {
          channel: config.channel,
          message: messageText,
          timestamp: new Date().toISOString()
        }
      };
    });
  },

  notify(
    this: Workflow<any>,
    title: string,
    config: {
      users: string[];
      message: string | ((ctx: any) => string);
    }
  ) {
    return this.step(title, async ({ context }) => {
      const messageText = typeof config.message === 'function'
        ? config.message(context)
        : config.message;

      console.log(`[SLACK] Notifying users ${config.users.join(', ')}: ${messageText}`);

      // Simulate sending notifications
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        ...context,
        lastSlackNotification: {
          users: config.users,
          message: messageText,
          timestamp: new Date().toISOString()
        }
      };
    });
  }
});

declare module "../dsl/blocks" {
  interface Workflow<TOptions extends object, TContext extends Context> {
    slack: ReturnType<typeof slackExtension.augment<TOptions, TContext>>;
  }
}

slackExtension.install();