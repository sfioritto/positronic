import type { CurrentUser } from '../types.js';
import type { FilesService } from '../../files/types.js';
import type { PagesService } from '../pages.js';
import type { Memory } from '../../memory/types.js';
import type { Store, StoreSchema } from '../../store/types.js';

/**
 * Context passed to service provider factories.
 * Contains per-run information needed to scope service instances.
 */
export interface ProviderContext {
  brainTitle: string;
  currentUser: CurrentUser;
  brainRunId: string;
}

/**
 * Factory that creates a scoped FilesService for a brain run.
 */
export type FilesProvider = (ctx: ProviderContext) => FilesService;

/**
 * Factory that creates a scoped PagesService for a brain run.
 */
export type PagesProvider = (ctx: ProviderContext) => PagesService;

/**
 * Factory that creates a typed Store for a brain run.
 * Receives the store schema declared by the brain via withStore().
 */
export type StoreProviderFactory = (
  ctx: ProviderContext & { schema: StoreSchema }
) => Store<any>;

/**
 * Factory that creates a scoped Memory service for a brain run.
 * Receives the scope config declared by the brain via withMemory().
 */
export type MemoryProviderFactory = (
  ctx: ProviderContext & { scope?: 'user' | 'brain' }
) => Memory;

/**
 * Service providers that the runner passes to brain.run().
 * Each provider is a factory function that creates a scoped service instance.
 * All providers are optional — missing providers throw at point of use.
 */
export interface ServiceProviders {
  files?: FilesProvider;
  pages?: PagesProvider;
  store?: StoreProviderFactory;
  memory?: MemoryProviderFactory;
}
