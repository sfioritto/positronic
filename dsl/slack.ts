import { WorkflowExtension, type Context } from "./blocks";
import { Expand } from "./blocks";

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

// Declare module augmentation with nested namespace
declare module "./blocks" {
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

export const slackExtension: WorkflowExtension = (workflow) => {
  // Create the slack namespace
  workflow.slack = {
    message(
      title: string,
      config: {
        channel: string;
        message: string | ((ctx: any) => string);
      }
    ) {
      return workflow.step(title, async ({ context }) => {
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
      title: string,
      config: {
        users: string[];
        message: string | ((ctx: any) => string);
      }
    ) {
      return workflow.step(title, async ({ context }) => {
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
};