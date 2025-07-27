import type { Brain } from '@positronic/core';

export interface BrainMetadata {
  filename: string;
  path: string;
  brain: Brain;
}

export interface BrainCandidate {
  title: string;
  filename: string;
  path: string;
  description?: string;
}

export interface ResolutionResult {
  matchType: 'exact' | 'multiple' | 'none';
  brain?: Brain;
  candidates?: BrainCandidate[];
}

export class BrainResolver {
  private metadataCache: Map<string, { title: string; description?: string }> = new Map();

  constructor(private enhancedManifest: Record<string, BrainMetadata>) {
    // Pre-cache brain titles and descriptions
    for (const [filename, metadata] of Object.entries(enhancedManifest)) {
      const brain = metadata.brain;
      // Access brain structure to get title and description
      const structure = brain.structure;
      this.metadataCache.set(filename, {
        title: structure.title || filename,
        description: structure.description,
      });
    }
  }

  resolve(identifier: string): ResolutionResult {
    const candidates: BrainCandidate[] = [];
    
    // Normalize identifier for comparison
    const normalizedIdentifier = identifier.toLowerCase().trim();
    
    // Check each brain in the manifest
    for (const [filename, metadata] of Object.entries(this.enhancedManifest)) {
      const cached = this.metadataCache.get(filename)!;
      const title = cached.title;
      const description = cached.description;
      
      // 1. Exact title match (case-insensitive)
      if (title.toLowerCase() === normalizedIdentifier) {
        return {
          matchType: 'exact',
          brain: metadata.brain,
        };
      }
      
      // 2. Exact filename match (case-insensitive)
      if (filename.toLowerCase() === normalizedIdentifier) {
        return {
          matchType: 'exact',
          brain: metadata.brain,
        };
      }
      
      // 3. Exact path match (case-insensitive)
      if (metadata.path.toLowerCase() === normalizedIdentifier) {
        return {
          matchType: 'exact',
          brain: metadata.brain,
        };
      }
      
      // Collect candidates for partial matching
      const candidate: BrainCandidate = {
        title,
        filename,
        path: metadata.path,
        description,
      };
      
      // 4. Partial path match
      if (metadata.path.toLowerCase().includes(normalizedIdentifier)) {
        candidates.push(candidate);
        continue;
      }
      
      // 5. Title contains identifier
      if (title.toLowerCase().includes(normalizedIdentifier)) {
        candidates.push(candidate);
        continue;
      }
      
      // 6. Filename contains identifier
      if (filename.toLowerCase().includes(normalizedIdentifier)) {
        candidates.push(candidate);
        continue;
      }
      
      // 7. Description contains identifier (if exists)
      if (description && description.toLowerCase().includes(normalizedIdentifier)) {
        candidates.push(candidate);
      }
    }
    
    // Handle results
    if (candidates.length === 0) {
      return { matchType: 'none' };
    } else if (candidates.length === 1) {
      // Single match found through partial matching
      const match = this.enhancedManifest[candidates[0].filename];
      return {
        matchType: 'exact',
        brain: match.brain,
      };
    } else {
      // Multiple matches found
      return {
        matchType: 'multiple',
        candidates,
      };
    }
  }
  
  /**
   * Get a brain by exact filename (used for backward compatibility)
   */
  getByFilename(filename: string): Brain | undefined {
    const metadata = this.enhancedManifest[filename];
    return metadata?.brain;
  }
  
  /**
   * List all available brains
   */
  list(): string[] {
    return Object.keys(this.enhancedManifest);
  }
}