import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

const encoder = new Tiktoken(cl100k_base);

export function estimateTokens(text: string): number {
  return encoder.encode(text).length;
}

export function estimateRequestTokens({
  prompt,
  messages,
  system,
}: {
  prompt?: string;
  messages?: Array<{ content: string }>;
  system?: string;
}): number {
  const parts: string[] = [];

  if (system) {
    parts.push(system);
  }

  if (messages) {
    for (const msg of messages) {
      parts.push(msg.content);
    }
  }

  if (prompt) {
    parts.push(prompt);
  }

  return estimateTokens(parts.join('\n'));
}
