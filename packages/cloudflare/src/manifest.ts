import type { Brain } from '@positronic/core';

interface BrainImportStrategy {
  import(name: string): Promise<Brain | undefined>;
  list(): string[];
}

class StaticManifestStrategy implements BrainImportStrategy {
  constructor(private manifest: Record<string, Brain>) {}

  async import(name: string): Promise<Brain | undefined> {
    return this.manifest[name];
  }

  list(): string[] {
    return Object.keys(this.manifest);
  }
}

class DynamicImportStrategy implements BrainImportStrategy {
  constructor(private brainsDir: string) {}

  async import(name: string): Promise<Brain | undefined> {
    try {
      const module = await import(`${this.brainsDir}/${name}.ts`);
      return module.default;
    } catch (e) {
      console.error(`Failed to import brain ${name}:`, e);
      return undefined;
    }
  }

  list(): string[] {
    // For dynamic imports, we can't easily list files at runtime in a worker environment
    // This would need to be handled differently, perhaps by generating a list at build time
    console.warn('DynamicImportStrategy.list() is not implemented - returning empty array');
    return [];
  }
}

export class PositronicManifest {
  private importStrategy: BrainImportStrategy;

  constructor(options: {
    staticManifest?: Record<string, Brain>;
    brainsDir?: string;
  }) {
    if (options.staticManifest && options.brainsDir) {
      throw new Error(
        'Cannot provide both staticManifest and brainsDir - choose one import strategy'
      );
    }
    if (!options.staticManifest && !options.brainsDir) {
      throw new Error('Must provide either staticManifest or brainsDir');
    }

    this.importStrategy = options.staticManifest
      ? new StaticManifestStrategy(options.staticManifest)
      : new DynamicImportStrategy(options.brainsDir!);
  }

  async import(name: string): Promise<Brain | undefined> {
    return this.importStrategy.import(name);
  }

  list(): string[] {
    return this.importStrategy.list();
  }
}
