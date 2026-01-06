import { z } from 'zod';
import { brain } from '../brain.js';

const exampleBrain = brain('example')
  .step('Start', ({ state }) => ({
    ...state,
    topic: 'AI workflows',
  }))
  .step('Generate greeting', async ({ state, client }) => {
    const result = await client.generateObject({
      schema: z.object({
        greeting: z.string(),
        funFact: z.string(),
      }),
      schemaName: 'greeting',
      prompt:
        'Create a friendly greeting about ' + state.topic + '. Include a fun fact.',
    });
    return {
      ...state,
      greeting: result.greeting,
      funFact: result.funFact,
    };
  })
  .step('Finish', ({ state }) => ({
    ...state,
    finalMessage: state.greeting + ' Fun fact: ' + state.funFact,
  }));

export default exampleBrain;