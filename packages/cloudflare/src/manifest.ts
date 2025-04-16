import type { Workflow } from '@positronic/core';

interface WorkflowImportStrategy {
  import(name: string): Promise<Workflow | undefined>;
}

class StaticManifestStrategy implements WorkflowImportStrategy {
  constructor(private manifest: Record<string, Workflow>) {}

  async import(name: string): Promise<Workflow | undefined> {
    return this.manifest[name];
  }
}

class DynamicImportStrategy implements WorkflowImportStrategy {
  constructor(private workflowsDir: string) {}

  async import(name: string): Promise<Workflow | undefined> {
    try {
      const module = await import(`${this.workflowsDir}/${name}.ts`);
      return module.default;
    } catch (e) {
      console.error(`Failed to import workflow ${name}:`, e);
      return undefined;
    }
  }
}

export class PositronicManifest {
  private importStrategy: WorkflowImportStrategy;

  constructor(options: {
    staticManifest?: Record<string, Workflow>,
    workflowsDir?: string
  }) {
    if (options.staticManifest && options.workflowsDir) {
      throw new Error('Cannot provide both staticManifest and workflowsDir - choose one import strategy');
    }
    if (!options.staticManifest && !options.workflowsDir) {
      throw new Error('Must provide either staticManifest or workflowsDir');
    }

    this.importStrategy = options.staticManifest
      ? new StaticManifestStrategy(options.staticManifest)
      : new DynamicImportStrategy(options.workflowsDir!);
  }

  async import(name: string): Promise<Workflow | undefined> {
    return this.importStrategy.import(name);
  }
}