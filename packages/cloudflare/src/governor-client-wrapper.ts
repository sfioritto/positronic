import type { ObjectGenerator } from '@positronic/core';
import type { GovernorDO, AcquireResult } from './governor-do.js';
import { estimateRequestTokens } from './token-estimator.js';

type GovernorStub = Pick<GovernorDO, 'acquire' | 'release'>;

interface GovernorNamespace {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): GovernorStub;
}

let governorNamespace: GovernorNamespace | null = null;

export function setGovernorBinding(ns: GovernorNamespace) {
  governorNamespace = ns;
}

function getGovernorStub(): GovernorStub | null {
  if (!governorNamespace) return null;
  return governorNamespace.get(governorNamespace.idFromName('governor'));
}

async function computeIdentity(modelId: string, apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${modelId}:${apiKey}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ACQUIRE_ATTEMPTS = 10;


interface GovernedCallParams<T> {
  governorStub: GovernorStub | null;
  identity: string;
  modelId: string;
  estimatedTokens: number;
  call: () => Promise<T>;
  extractUsage: (result: T) => {
    actualTokens: number;
    responseHeaders?: Record<string, string>;
  };
}

async function governedCall<T>({
  governorStub,
  identity,
  modelId,
  estimatedTokens,
  call,
  extractUsage,
}: GovernedCallParams<T>): Promise<T> {
  if (!governorStub) {
    return call();
  }

  const requestId = crypto.randomUUID();
  let leaseGranted = false;

  // Acquire loop
  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
    let result: AcquireResult;
    try {
      result = await governorStub.acquire({
        requestId,
        clientIdentity: identity,
        modelId,
        estimatedTokens,
      });
    } catch (error) {
      console.warn('Governor acquire RPC failed, proceeding without rate limiting:', error);
      break;
    }

    if (result.granted) {
      leaseGranted = true;
      break;
    }

    if (attempt < MAX_ACQUIRE_ATTEMPTS - 1 && result.retryAfterMs) {
      await sleep(result.retryAfterMs);
    }
  }

  if (!leaseGranted) {
    console.warn('Governor acquire exhausted retries, proceeding without rate limiting');
  }

  try {
    const result = await call();

    if (leaseGranted) {
      const { actualTokens, responseHeaders } = extractUsage(result);
      try {
        await governorStub.release({
          requestId,
          clientIdentity: identity,
          actualTokens,
          responseHeaders,
        });
      } catch (error) {
        console.warn('Governor release RPC failed:', error);
      }
    }

    return result;
  } catch (error) {
    if (leaseGranted) {
      try {
        await governorStub.release({
          requestId,
          clientIdentity: identity,
          actualTokens: estimatedTokens,
        });
      } catch (releaseError) {
        console.warn('Governor release RPC failed during error cleanup:', releaseError);
      }
    }
    throw error;
  }
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
      const governorStub = getGovernorStub();
      const estimated = estimateRequestTokens({
        prompt: params.prompt,
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        identity,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.generateObject(params),
        extractUsage: (result) => {
          const actualTokens = result.usage?.totalTokens ?? estimated;
          console.log(`[Governor] generateObject release: totalTokens=${result.usage?.totalTokens} estimated=${estimated} using=${actualTokens}`);
          return { actualTokens, responseHeaders: result.responseHeaders };
        },
      });
    },

    createToolResultMessage: client.createToolResultMessage
      ? (toolCallId, toolName, result) => client.createToolResultMessage!(toolCallId, toolName, result)
      : undefined,

    async streamText(params) {
      const identity = await getIdentity();
      const governorStub = getGovernorStub();
      const estimated = estimateRequestTokens({
        prompt: params.prompt,
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        identity,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.streamText(params),
        extractUsage: (result) => ({
          actualTokens: result.usage.totalTokens,
          responseHeaders: result.responseHeaders,
        }),
      });
    },
  };

  if (client.generateText) {
    wrapper.generateText = async (params) => {
      const identity = await getIdentity();
      const governorStub = getGovernorStub();
      const estimated = estimateRequestTokens({
        messages: params.messages as Array<{ content: string }> | undefined,
        system: params.system,
      });

      return governedCall({
        governorStub,
        identity,
        modelId: client.modelId ?? 'unknown',
        estimatedTokens: estimated,
        call: () => client.generateText!(params),
        extractUsage: (result) => ({
          actualTokens: result.usage.totalTokens,
          responseHeaders: result.responseHeaders,
        }),
      });
    };
  }

  return wrapper;
}
