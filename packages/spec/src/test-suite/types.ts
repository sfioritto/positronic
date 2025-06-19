import type { PositronicDevServer } from '@positronic/spec';

export interface ComplianceTestConfig {
  createDevServer: () => PositronicDevServer;
  backendName: string;
  config?: {
    skipTests?: string[];
    timeout?: number;
  };
}
