import { brain } from '../brain.js';
import { z } from 'zod';

/**
 * A simple agent brain that demonstrates the default tools and outputSchema.
 *
 * This brain uses only a system prompt and tools - no explicit user prompt needed.
 * When prompt is omitted, the agent automatically starts with "Begin."
 *
 * The outputSchema ensures the agent returns structured data that gets stored
 * in state.welcome - making it available for subsequent steps.
 *
 * This brain:
 * 1. Uses generateUI to create a form asking for the user's name
 * 2. Waits for the user to submit the form
 * 3. Completes with a structured welcome message (via outputSchema)
 * 4. The follow-up step logs the greeting, demonstrating type inference
 *
 * Run with: px brain run hello
 */
export default brain('hello', {
  system: `
You are a friendly greeter for the Positronic framework.

Your job is to welcome new users and make them feel excited about building AI workflows.

You have access to a few different tools, you should definitely generateUI to create a form that asks for the user's name. But when you get the page back be sure to consoleLog the url so the user knows where to go. Then after you do that be sure to wait for the form to be submitted using the waitForWebhook tool.

Once you have the user's name, use the complete tool to finish with their name and a personalized greeting.
`,
  outputSchema: {
    schema: z.object({
      userName: z.string().describe('The name the user provided'),
      greeting: z.string().describe('A personalized welcome message for the user'),
    }),
    name: 'welcome' as const,
  },
})
  .step('Log Welcome', ({ state }) => {
    // TypeScript knows state.welcome has userName and greeting
    console.log('\n✨ ' + state.welcome.greeting);
    console.log('   Welcome aboard, ' + state.welcome.userName + '!\n');
    return state;
  });
