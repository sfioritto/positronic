import { Workflow, type Expand, type Context } from "../dsl/blocks";

interface SlackMessage extends Context {
  channel: string;
  message: string;
  timestamp: string;
}

interface SlackNotification extends Context {
  users: string[];
  message: string;
  timestamp: string;
}

// Type augmentation - only available when this module is imported
declare module "../dsl/blocks" {
  interface Workflow<TContext> {
    slack: {
      message(
        title: string,
        config: {
          channel: string;
          message: string | ((ctx: TContext) => string);
        }
      ): Workflow<Expand<TContext & { lastSlackMessage: SlackMessage }>>;

      notify(
        title: string,
        config: {
          users: string[];
          message: string | ((ctx: TContext) => string);
        }
      ): Workflow<Expand<TContext & { lastSlackNotification: SlackNotification }>>;
    }
  }
}

// Wrap the prototype modification in an IIFE that runs after module initialization
(() => {
  const slackMethods = {
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
  };

  Workflow.prototype.slack = {
    message: slackMethods.message.bind(Workflow.prototype),
    notify: slackMethods.notify.bind(Workflow.prototype)
  };
})();