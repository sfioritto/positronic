import { Workflow } from "../dsl/blocks";
import { createWorkflowExtension } from "../dsl/extensions";

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