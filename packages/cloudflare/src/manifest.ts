import type { Brain } from '@positronic/core';
import { BrainResolver, type BrainMetadata, type ResolutionResult } from './brain-resolver.js';

export type { BrainMetadata, ResolutionResult } from './brain-resolver.js';

interface BrainImportStrategy {
  import(filename: string): Promise<Brain | undefined>;
  resolve(identifier: string): ResolutionResult;
  list(): string[];
}

class StaticManifestStrategy implements BrainImportStrategy {
  private resolver: BrainResolver;
  
  constructor(private manifest: Record<string, BrainMetadata>) {
    this.resolver = new BrainResolver(manifest);
  }

  async import(filename: string): Promise<Brain | undefined> {
    return this.manifest[filename]?.brain;
  }
  
  resolve(identifier: string): ResolutionResult {
    return this.resolver.resolve(identifier);
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
  
  resolve(identifier: string): ResolutionResult {
    // For dynamic imports, we can only do simple filename matching
    return this.import(identifier).then(brain => 
      brain ? { matchType: 'exact' as const, brain } : { matchType: 'none' as const }
    ) as any; // Type assertion needed due to async
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
    manifest?: Record<string, BrainMetadata>;
    brainsDir?: string;
  }) {
    if (options.manifest && options.brainsDir) {
      throw new Error(
        'Cannot provide both manifest and brainsDir - choose one import strategy'
      );
    }
    if (!options.manifest && !options.brainsDir) {
      throw new Error('Must provide either manifest or brainsDir');
    }

    this.importStrategy = options.manifest
      ? new StaticManifestStrategy(options.manifest)
      : new DynamicImportStrategy(options.brainsDir!);
  }

  async import(filename: string): Promise<Brain | undefined> {
    return this.importStrategy.import(filename);
  }
  
  resolve(identifier: string): ResolutionResult {
    return this.importStrategy.resolve(identifier);
  }

  list(): string[] {
    return this.importStrategy.list();
  }
}
