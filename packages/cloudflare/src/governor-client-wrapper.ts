import type { ObjectGenerator } from '@positronic/core';
import type { GovernorDO } from './governor-do.js';
import { estimateRequestTokens } from './token-estimator.js';

type GovernorStub = Pick<GovernorDO, 'waitForCapacity' | 'reportHeaders'>;

interface GovernorNamespace {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): GovernorStub;
}

let governorNamespace: GovernorNamespace | null = null;

export function setGovernorBinding(ns: GovernorNamespace) {
  governorNamespace = ns;
}

function getGovernorStub(identity: string): GovernorStub | null {
  if (!governorNamespace) return null;
  return governorNamespace.get(governorNamespace.idFromName(identity));
}

async function computeIdentity(modelId: string, apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${modelId}:${apiKey}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface GovernedCallParams<T> {
  governorStub: GovernorStub | null;
  modelId: string;
  estimatedTokens: number;
  call: () => Promise<T>;
  extractHeaders: (result: T) => Record<string, string> | undefined;
}

async function governedCall<T>({
  governorStub,
  modelId,
  estimatedTokens,
  call,
  extractHeaders,
}: GovernedCallParams<T>): Promise<T> {
  if (!governorStub) {
    return call();
  }

  try {
    await governorStub.waitForCapacity(modelId, estimatedTokens);
  } catch (error) {
    console.warn('Governor waitForCapacity failed, proceeding without rate limiting:', error);
  }

  const result = await call();

  const headers = extractHeaders(result);
  if (headers) {
    governorStub.reportHeaders(headers);
  }

  return result;
}

export function rateGoverned(
  client: ObjectGenerator,
): ObjectGenerator {
  const apiKey = client.apiKey ?? '';
  let cachedIdentity: string | null = null;

  async function getIdentity(): Promise<string> {
    if (cachedIdentity) return cachedIdentity;
    const modelId = client.modelId ?? 'unknown';
    cachedIdentity = await computeIdentity(modelId, apiKey);
    return cachedIdentity;
  }

  const wrapper: ObjectGenerator = {
    get identity() {
      return client.identity;
    },

    get modelId() {
      return client.modelId;
    },

    get apiKey() {
      return client.apiKey;
    },

    async generateObject(params) {
      const identity = await getIdentity();
      const governorStub = getGovernorStub(identity);
      const estimated = estimateRequestTokens({
        prompt: params.prompt,
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.generateObject(params),
        extractHeaders: (result) => result.responseHeaders,
      });
    },

    createToolResultMessage: client.createToolResultMessage
      ? (toolCallId, toolName, result) => client.createToolResultMessage!(toolCallId, toolName, result)
      : undefined,

    async streamText(params) {
      const identity = await getIdentity();
      const governorStub = getGovernorStub(identity);
      const estimated = estimateRequestTokens({
        prompt: params.prompt,
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.streamText(params),
        extractHeaders: (result) => result.responseHeaders,
      });
    },
  };

  if (client.generateText) {
    wrapper.generateText = async (params) => {
      const identity = await getIdentity();
      const governorStub = getGovernorStub(identity);
      const estimated = estimateRequestTokens({
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.generateText!(params),
        extractHeaders: (result) => result.responseHeaders,
      });
    };
  }

  return wrapper;
}
