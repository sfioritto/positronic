import { BrainRunner } from '@positronic/core';
import { VercelClient } from '@positronic/client-vercel';
import { openai } from '@ai-sdk/openai';

export const runner = new BrainRunner({
  adapters: [],
  client: new VercelClient(openai('gpt-4o-mini')),
  resources: {},
});