/**
 * Memory Service
 *
 * High-level service for managing project memories.
 * Provides a unified API for memory operations including
 * CRUD, search, and keyword detection.
 */

import type { DatabaseLike } from '../db/index.ts';
import type { Memory, MemoryType, MemorySource, ResolvedMemoirConfig } from '../types.ts';
import { MemoryRepository, type UpdateMemoryInput } from './repository.ts';
import { searchMemories, type SearchResult, type SearchOptions } from './search.ts';
import { detectMemoryKeyword } from './keywords.ts';

// Re-export types and utilities
export { MemoryRepository, type CreateMemoryInput, type UpdateMemoryInput } from './repository.ts';
export {
  searchMemories,
  searchByType,
  getRecentMemories,
  type SearchResult,
  type SearchOptions,
} from './search.ts';
export {
  DEFAULT_KEYWORDS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  removeCodeBlocks,
  buildKeywordPattern,
  detectMemoryKeyword,
} from './keywords.ts';

/**
 * Options for adding a new memory.
 */
export interface AddMemoryOptions {
  /** Optional tags for categorization */
  tags?: string[];

  /** How this memory was created */
  source?: MemorySource;
}

/**
 * Options for listing memories.
 */
export interface ListMemoriesOptions {
  /** Maximum number of memories to return */
  limit?: number;

  /** Number of memories to skip */
  offset?: number;

  /** Filter by memory type */
  type?: MemoryType;
}

/**
 * High-level service for managing project memories.
 *
 * Provides a unified API for all memory operations including:
 * - Adding and updating memories
 * - Searching with full-text search
 * - Keyword detection for auto-save triggers
 *
 * @example
 * ```typescript
 * // Initialize the service
 * const db = DatabaseService.get().getDatabase();
 * const config = ConfigService.get();
 * initializeMemoryService(db, config);
 *
 * // Use the service
 * const service = getMemoryService();
 * const memory = service.add('Always use strict mode', 'preference');
 * const results = service.search('strict mode');
 * ```
 */
export class MemoryService {
  private readonly repository: MemoryRepository;
  private readonly config: ResolvedMemoirConfig;
  private readonly db: DatabaseLike;

  /**
   * Creates a new MemoryService instance.
   *
   * @param db - The database connection
   * @param config - The resolved configuration
   */
  constructor(db: DatabaseLike, config: ResolvedMemoirConfig) {
    this.db = db;
    this.config = config;
    this.repository = new MemoryRepository(db);
  }

  /**
   * Adds a new memory to the database.
   *
   * @param content - The memory content text
   * @param type - The memory category
   * @param options - Additional options (tags, source)
   * @returns The created Memory object
   *
   * @example
   * ```typescript
   * const memory = service.add(
   *   'Use Result<T, E> for error handling',
   *   'pattern',
   *   { tags: ['error-handling', 'typescript'] }
   * );
   * ```
   */
  add(content: string, type: MemoryType, options?: AddMemoryOptions): Memory {
    return this.repository.create({
      content,
      type,
      tags: options?.tags,
      source: options?.source,
    });
  }

  /**
   * Searches memories using full-text search.
   *
   * @param query - The search query string
   * @param options - Search options (limit, type filter)
   * @returns Array of SearchResult objects sorted by relevance
   *
   * @example
   * ```typescript
   * const results = service.search('typescript config');
   * for (const { memory, rank } of results) {
   *   console.log(`[${rank.toFixed(2)}] ${memory.content}`);
   * }
   * ```
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    const limit = options?.limit ?? this.config.memory.maxSearchResults;
    return searchMemories(this.db, query, { ...options, limit });
  }

  /**
   * Searches for relevant memories to inject into context.
   *
   * Uses the configured maxInject limit to return the most relevant
   * memories for a given query. Intended for context injection on
   * first message.
   *
   * @param query - The search query (typically the user's message)
   * @returns Array of relevant Memory objects
   *
   * @example
   * ```typescript
   * const relevant = service.searchRelevant('How do I handle errors?');
   * // Returns up to config.memory.maxInject memories
   * ```
   */
  searchRelevant(query: string): Memory[] {
    // Early return if query is empty or too short
    if (!query || query.trim().length < 2) {
      return [];
    }

    const results = searchMemories(this.db, query, {
      limit: this.config.memory.maxInject,
    });
    return results.map((r) => r.memory);
  }

  /**
   * Lists memories with optional filtering and pagination.
   *
   * @param options - Filtering and pagination options
   * @returns Array of Memory objects
   *
   * @example
   * ```typescript
   * // Get all preferences
   * const prefs = service.list({ type: 'preference' });
   *
   * // Paginate through all memories
   * const page1 = service.list({ limit: 10, offset: 0 });
   * const page2 = service.list({ limit: 10, offset: 10 });
   * ```
   */
  list(options?: ListMemoriesOptions): Memory[] {
    return this.repository.list(options);
  }

  /**
   * Retrieves a memory by its ID.
   *
   * @param id - The memory ID to look up
   * @returns The Memory object, or null if not found
   *
   * @example
   * ```typescript
   * const memory = service.get('mem_7xKj9mN2pQ4r');
   * if (memory) {
   *   console.log(memory.content);
   * }
   * ```
   */
  get(id: string): Memory | null {
    return this.repository.getById(id);
  }

  /**
   * Updates an existing memory.
   *
   * @param id - The memory ID to update
   * @param input - The fields to update
   * @returns The updated Memory object, or null if not found
   *
   * @example
   * ```typescript
   * const updated = service.update('mem_7xKj9mN2pQ4r', {
   *   content: 'Updated content',
   *   tags: ['new-tag']
   * });
   * ```
   */
  update(id: string, input: UpdateMemoryInput): Memory | null {
    return this.repository.update(id, input);
  }

  /**
   * Deletes a memory by its ID.
   *
   * @param id - The memory ID to delete
   * @returns True if the memory was deleted, false if not found
   *
   * @example
   * ```typescript
   * if (service.forget('mem_7xKj9mN2pQ4r')) {
   *   console.log('Memory deleted');
   * }
   * ```
   */
  forget(id: string): boolean {
    return this.repository.delete(id);
  }

  /**
   * Detects if text contains memory-related keywords.
   *
   * Uses the configured keyword detection settings and custom keywords.
   * Returns false if keyword detection is disabled in config.
   *
   * @param text - The text to check for keywords
   * @returns True if keywords are detected and detection is enabled
   *
   * @example
   * ```typescript
   * if (service.detectKeyword('Please remember this preference')) {
   *   // Trigger auto-save flow
   * }
   * ```
   */
  detectKeyword(text: string): boolean {
    // Check if keyword detection is enabled
    if (!this.config.memory.keywordDetection) {
      return false;
    }

    // Use custom keywords from config if available
    const customKeywords = this.config.memory.customKeywords;
    return detectMemoryKeyword(text, customKeywords.length > 0 ? customKeywords : undefined);
  }
}

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

/** Singleton instance of the MemoryService */
let memoryService: MemoryService | null = null;

/**
 * Initializes the memory service singleton.
 *
 * Creates a new MemoryService instance with the provided database and config.
 * If already initialized, returns the existing instance.
 *
 * @param db - The database connection
 * @param config - The resolved configuration
 * @returns The initialized MemoryService instance
 *
 * @example
 * ```typescript
 * const db = DatabaseService.get().getDatabase();
 * const config = resolveConfig(worktree).config;
 * initializeMemoryService(db, config);
 * ```
 */
export function initializeMemoryService(
  db: DatabaseLike,
  config: ResolvedMemoirConfig
): MemoryService {
  if (!memoryService) {
    memoryService = new MemoryService(db, config);
  }
  return memoryService;
}

/**
 * Gets the memory service singleton.
 *
 * @returns The MemoryService instance
 * @throws Error if the service has not been initialized
 *
 * @example
 * ```typescript
 * const service = getMemoryService();
 * const memories = service.list();
 * ```
 */
export function getMemoryService(): MemoryService {
  if (!memoryService) {
    throw new Error('MemoryService not initialized. Call initializeMemoryService() first.');
  }
  return memoryService;
}

/**
 * Resets the memory service singleton.
 *
 * Clears the singleton instance. Primarily used for testing
 * or when reinitializing with a different database/config.
 *
 * @example
 * ```typescript
 * resetMemoryService();
 * initializeMemoryService(newDb, newConfig);
 * ```
 */
export function resetMemoryService(): void {
  memoryService = null;
}
