import { BrainRunner } from '@positronic/core';
import { VercelClient } from '@positronic/client-vercel';
import { google } from '@ai-sdk/google';

export const runner = new BrainRunner({
  adapters: [],
  client: new VercelClient(google('gemini-3-pro-preview')),
  resources: {},
});