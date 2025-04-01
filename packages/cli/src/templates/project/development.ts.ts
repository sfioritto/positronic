export default ({ projectName }: { projectName: string }) => (`
import { WorkflowRunner } from '@positronic/core';
import { AnthropicClient } from '@positronic/client-anthropic';
import Database from 'better-sqlite3';

/**
 * Development configuration for ${projectName}
 * This runner will be used when running workflows with the CLI in development
 */
export const runner = new WorkflowRunner({
  adapters: [
    // Add your adapters here
  ],
  logger: console,
  verbose: true,
  client: new AnthropicClient(),
});
`);