import type { Brain } from '@positronic/core';
import { BrainResolver, type BrainMetadata, type ResolutionResult } from './brain-resolver.js';

export type { BrainMetadata, ResolutionResult } from './brain-resolver.js';

interface BrainImportStrategy {
  import(filename: string): Promise<Brain | undefined>;
  resolve(identifier: string): ResolutionResult;
  list(): string[];
}

class StaticManifestStrategy implements BrainImportStrategy {
  private resolver?: BrainResolver;
  
  constructor(
    private manifest: Record<string, Brain>,
    private enhancedManifest?: Record<string, BrainMetadata>
  ) {
    if (enhancedManifest) {
      this.resolver = new BrainResolver(enhancedManifest);
    }
  }

  async import(filename: string): Promise<Brain | undefined> {
    return this.manifest[filename];
  }
  
  resolve(identifier: string): ResolutionResult {
    if (this.resolver) {
      return this.resolver.resolve(identifier);
    }
    
    // Fallback for legacy manifest without metadata
    const brain = this.manifest[identifier];
    if (brain) {
      return { matchType: 'exact', brain };
    }
    return { matchType: 'none' };
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
    staticManifest?: Record<string, Brain>;
    enhancedManifest?: Record<string, BrainMetadata>;
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
      ? new StaticManifestStrategy(options.staticManifest, options.enhancedManifest)
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
