import { Workflow } from "../dsl/blocks";
import { createExtension } from "../dsl/extensions";
import type { State } from "../dsl/types";
const slackExtension = createExtension('slack', {
  message(
    this: Workflow<any>,
    title: string,
    config: {
      channel: string;
      message: string | ((ctx: any) => string);
    }
  ) {
    return this.step(title, async ({ state }) => {
      const messageText = typeof config.message === 'function'
        ? config.message(state)
        : config.message;

      console.log(`[SLACK] Sending message to ${config.channel}: ${messageText}`);

      // Simulate sending message
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        ...state,
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
    return this.step(title, async ({ state }) => {
      const messageText = typeof config.message === 'function'
        ? config.message(state)
        : config.message;

      console.log(`[SLACK] Notifying users ${config.users.join(', ')}: ${messageText}`);

      // Simulate sending notifications
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        ...state,
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
  interface Workflow<TOptions extends object, TState extends State> {
    slack: ReturnType<typeof slackExtension.augment<TOptions, TState>>;
  }
}

slackExtension.install();