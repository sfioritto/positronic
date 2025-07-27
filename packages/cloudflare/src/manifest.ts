import type { Brain } from '@positronic/core';

interface BrainImportStrategy {
  import(filename: string): Promise<Brain | undefined>;
  list(): string[];
}

class StaticManifestStrategy implements BrainImportStrategy {
  constructor(private manifest: Record<string, Brain>) {}

  async import(filename: string): Promise<Brain | undefined> {
    return this.manifest[filename];
  }

  list(): string[] {
    return Object.keys(this.manifest);
  }
}

class DynamicImportStrategy implements BrainImportStrategy {
  constructor(private brainsDir: string) {}

  async import(filename: string): Promise<Brain | undefined> {
    try {
      const module = await import(`${this.brainsDir}/${filename}.ts`);
      return module.default;
    } catch (e) {
      console.error(`Failed to import brain ${filename}:`, e);
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

  async import(filename: string): Promise<Brain | undefined> {
    return this.importStrategy.import(filename);
  }

  list(): string[] {
    return this.importStrategy.list();
  }
}
