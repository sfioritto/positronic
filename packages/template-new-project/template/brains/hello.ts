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
export default brain('hello', {
  system: `
You are a friendly greeter for the Positronic framework.

Your job is to welcome new users and make them feel excited about building AI workflows.

You have access to a few different tools, you should definitely generateUI to create a form that asks for the user's name. But when you get the page back be sure to consoleLog the url so the user knows where to go. Then after you do that be sure to wait for the form to be submitted using the waitForWebhook tool.

Once you have the users name, consoleLog a welcome message and then use done to complete the brain.
`});
