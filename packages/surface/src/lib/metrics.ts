import type { ObjectGenerator } from '@positronic/core';

interface SampleStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

interface ModelUsage {
  calls: number;
  totalTokens: number;
}

function emptyStats(): SampleStats {
  return { count: 0, totalMs: 0, minMs: 0, maxMs: 0 };
}

function emptyUsage(): ModelUsage {
  return { calls: 0, totalTokens: 0 };
}

export class RunMetrics {
  private readonly startMs = Date.now();
  private endMs: number | null = null;

  private readonly models = new Map<string, ModelUsage>();
  readonly samples = new Map<string, SampleStats>();

  markEnd() {
    this.endMs = Date.now();
  }

  recordLLMCall(modelId: string | undefined, totalTokens: number | undefined) {
    const key = modelId ?? 'unknown';
    const entry = this.models.get(key) ?? emptyUsage();
    entry.calls += 1;
    entry.totalTokens += totalTokens ?? 0;
    this.models.set(key, entry);
  }

  record(name: string, durationMs: number) {
    const entry = this.samples.get(name) ?? emptyStats();
    addSample(entry, durationMs);
    this.samples.set(name, entry);
  }

  report(): string {
    const totalMs = (this.endMs ?? Date.now()) - this.startMs;

    const lines: string[] = [];
    lines.push('=== run metrics ===');
    lines.push(`total wall-clock: ${fmtMs(totalMs)}`);
    lines.push('');

    lines.push('models:');
    if (this.models.size === 0) {
      lines.push('  (no LLM calls recorded)');
    } else {
      for (const [model, u] of this.models) {
        lines.push(
          `  ${model}: ${u.calls} call${
            u.calls === 1 ? '' : 's'
          } — total tokens: ${u.totalTokens}`
        );
      }
    }
    lines.push('');

    lines.push('timings:');
    if (this.samples.size === 0) {
      lines.push('  (none)');
    } else {
      for (const [name, s] of this.samples) {
        lines.push(`  ${name}: ${formatStats(s)}`);
      }
    }

    return lines.join('\n');
  }
}

function addSample(stats: SampleStats, ms: number) {
  stats.count += 1;
  stats.totalMs += ms;
  stats.minMs = stats.count === 1 ? ms : Math.min(stats.minMs, ms);
  stats.maxMs = Math.max(stats.maxMs, ms);
}

function formatStats(s: SampleStats): string {
  if (s.count === 0) return '(none)';
  const avg = s.totalMs / s.count;
  return (
    `${s.count} call${s.count === 1 ? '' : 's'} — ` +
    `avg=${fmtMs(avg)} min=${fmtMs(s.minMs)} max=${fmtMs(s.maxMs)}`
  );
}

function fmtMs(ms: number): string {
  if (!isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Wrap an ObjectGenerator so every generateObject / streamText call records
 * token usage + per-step duration against `metrics`. `tag` labels the client
 * (orchestrator / subagent / reviewer) so metric keys stay separable when
 * roles share a model — without it they'd collapse into one metric line,
 * hiding which role was slow.
 *
 * Each call also emits a `[llm-trace]` stdout line so wrangler's log can be
 * grepped for slow calls and correlated with input size / token counts.
 */
export function instrumentClient(
  base: ObjectGenerator,
  metrics: RunMetrics,
  tag: string = 'default'
): ObjectGenerator {
  const modelKey = base.modelId ?? 'unknown';
  const labelBase = `${modelKey}:${tag}`;

  return {
    identity: base.identity,
    modelId: base.modelId,
    apiKey: base.apiKey,

    async generateObject(params) {
      const start = Date.now();
      const p = params as { attachments?: Array<{ data?: Uint8Array }> };
      const attachmentKB = Math.round(
        (p.attachments ?? []).reduce(
          (s, a) => s + (a?.data?.byteLength ?? 0),
          0
        ) / 1024
      );
      const result = await base.generateObject(params);
      const ms = Date.now() - start;
      metrics.recordLLMCall(base.modelId, result.usage?.totalTokens);
      metrics.record(`llm-call:${labelBase}`, ms);
      const usage = result.usage as
        | { inputTokens?: number; outputTokens?: number }
        | undefined;
      console.log(
        `[llm-trace] ${labelBase} generateObject dur=${ms}ms ` +
          `in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'} ` +
          `attachmentKB=${attachmentKB}`
      );
      return result;
    },

    streamText: (params) => {
      const outerOnStepFinish = params.onStepFinish;
      let stepStart = Date.now();
      let stepIdx = 0;
      return base.streamText({
        ...params,
        onStepFinish: async (step) => {
          const ms = Date.now() - stepStart;
          stepStart = Date.now();
          stepIdx += 1;
          metrics.recordLLMCall(base.modelId, step.usage?.totalTokens);
          metrics.record(`llm-step:${labelBase}`, ms);
          const u = step.usage as
            | {
                inputTokens?: number;
                outputTokens?: number;
                cachedInputTokens?: number;
              }
            | undefined;
          console.log(
            `[llm-trace] ${labelBase} step=${stepIdx} dur=${ms}ms ` +
              `in=${u?.inputTokens ?? '?'} out=${u?.outputTokens ?? '?'} ` +
              `cached=${u?.cachedInputTokens ?? '?'} finish=${
                step.finishReason ?? '?'
              }`
          );
          if (outerOnStepFinish) await outerOnStepFinish(step);
        },
      });
    },

    createToolResultMessage: base.createToolResultMessage?.bind(base),
    generateText: base.generateText?.bind(base),
  };
}
