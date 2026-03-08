import type { Hono } from 'hono';
import type { BrainRunnerDO } from '../brain-runner-do.js';
import type { MonitorDO } from '../monitor-do.js';
import type { ScheduleDO } from '../schedule-do.js';
import type { AuthDO } from '../auth-do.js';
import type { R2Bucket } from '@cloudflare/workers-types';

export type Bindings = {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  AUTH_DO: DurableObjectNamespace<AuthDO>;
  RESOURCES_BUCKET: R2Bucket;
  NODE_ENV?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  // Cloudflare API credentials for secrets management
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_SCRIPT_NAME?: string;
  // Origin URL for constructing page URLs
  WORKER_URL?: string;
  // Root public key for bootstrapping first user (JWK format)
  ROOT_PUBLIC_KEY?: string;
};

export type HonoApp = Hono<{ Bindings: Bindings }>;

export type CreateBrainRunRequest = {
  brainTitle: string;
  options?: Record<string, string>;
};

export type CreateBrainRunResponse = {
  brainRunId: string;
};
