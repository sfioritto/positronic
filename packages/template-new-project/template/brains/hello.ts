import { brain } from '../brain.js';

/**
 * A simple agent brain that demonstrates the default tools.
 *
 * This brain uses only a system prompt and tools - no explicit user prompt needed.
 * When prompt is omitted, the agent automatically starts with "Begin."
 *
 * This brain:
 * 1. Uses generateUI to create a form asking for the user's name
 * 2. Waits for the user to submit the form
 * 3. Uses consoleLog to log a personalized greeting
 * 4. Uses done to complete with a welcome message
 *
 * Run with: px brain run hello
 */
export default brain('hello', ({ tools }) => ({
  system: `You are a friendly greeter for the Positronic framework.
Your job is to welcome new users and make them feel excited about building AI workflows.

When you start:
1. Use generateUI to create a simple, welcoming form that asks for the user's name
   (use a friendly title and a single text input)
2. After receiving their name, use consoleLog to log a warm, personalized greeting
3. Use done to complete with an encouraging message about what they can build

You have access to these tools:
- generateUI: Create a form to collect the user's name
- consoleLog: Log messages to the console
- done: Complete the greeting with a final message`,

  tools,
}));
