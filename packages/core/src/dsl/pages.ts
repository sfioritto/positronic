/**
 * Page metadata returned from page operations
 */
export interface Page {
  slug: string;
  url: string;
  brainRunId: string;
  persist: boolean;
  ttl?: number;
  createdAt: string;
}

/**
 * Options for creating a page
 */
export interface PageCreateOptions {
  /** If true, page survives brain completion. Default: false (auto-cleanup) */
  persist?: boolean;
  /** Optional TTL in seconds (only meaningful for persist:true pages) */
  ttl?: number;
}

/**
 * Service for creating and managing pages during brain execution.
 *
 * Pages are HTML documents stored in R2 that can be accessed via URL.
 * They typically contain forms that POST to webhooks to resume brain execution.
 *
 * By default, pages are cleaned up when the brain run completes.
 * Use `persist: true` to keep pages across brain runs (e.g., for shared todo lists).
 */
export interface PagesService {
  /**
   * Create or update a page with the given HTML content.
   *
   * @param slug - User-provided identifier for the page (used in URL)
   * @param html - The HTML content to store
   * @param options - Optional settings (persist, ttl)
   * @returns Page metadata including the public URL
   */
  create(slug: string, html: string, options?: PageCreateOptions): Promise<Page>;

  /**
   * Get the current HTML content of a page.
   * Useful for reading before updating (since updates are full-replace).
   *
   * @param slug - The page slug
   * @returns The HTML content, or null if page doesn't exist
   */
  get(slug: string): Promise<string | null>;

  /**
   * Check if a page exists and get its metadata.
   *
   * @param slug - The page slug
   * @returns Page metadata, or null if page doesn't exist
   */
  exists(slug: string): Promise<Page | null>;

  /**
   * Update an existing page's HTML content.
   * Preserves the page's metadata (persist, ttl, brainRunId).
   *
   * @param slug - The page slug
   * @param html - The new HTML content
   * @returns Updated page metadata
   * @throws If the page doesn't exist
   */
  update(slug: string, html: string): Promise<Page>;
}
