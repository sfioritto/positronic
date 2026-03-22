import { brain } from '../brain.js';
import { z } from 'zod';
import { generatePage, waitForWebhook } from '@positronic/core';

/**
 * A simple brain that demonstrates .prompt() with a tool-calling loop.
 *
 * This brain:
 * 1. Uses generatePage to create a form asking for the user's name
 * 2. Waits for the user to submit the form
 * 3. Completes with a structured welcome message (via the 'done' tool)
 * 4. The follow-up step logs the greeting, demonstrating type inference
 *
 * The `loop` property on `.prompt()` enables tool-calling: the LLM calls
 * tools iteratively until it calls the auto-generated 'done' tool with
 * data matching the outputSchema. The result is spread onto state.
 *
 * Run with: px brain run hello
 */
export default brain('hello')
  .prompt('Greet User', () => ({
    system: `
You are a friendly greeter for the Positronic framework.

Your job is to welcome new users and make them feel excited about building AI workflows.

Use the generatePage tool to create a form asking for the user's name.
Once you have their name, call 'done' with a personalized greeting.
`,
    message: 'Begin.',
    outputSchema: z.object({
      userName: z.string().describe('The name the user provided'),
      greeting: z
        .string()
        .describe('A personalized welcome message for the user'),
    }),
    loop: {
      tools: { generatePage, waitForWebhook },
    },
  }))
  .step('Log Welcome', ({ state }) => {
    // TypeScript knows state has userName and greeting (spread from outputSchema)
    console.log('\n✨ ' + state.greeting);
    console.log('   Welcome aboard, ' + state.userName + '!\n');
    return state;
  });
