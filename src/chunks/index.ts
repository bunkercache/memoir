/**
 * Chunk Service
 *
 * Main entry point for chunk operations in the Memoir plugin.
 * Provides high-level methods for creating, finalizing, compacting,
 * and searching chunks.
 */

import type { DatabaseLike } from '../db/index.ts';
import type { Chunk, ChunkContent, ChunkStatus, ResolvedMemoirConfig } from '../types.ts';
import { ChunkRepository } from './repository.ts';
import { compactChunks, getDescendants, type CompactResult } from './tree.ts';
import { getMessageTracker } from './tracker.ts';

/**
 * Search result with ranking information.
 */
export interface SearchResult {
  /** The matching chunk */
  chunk: Chunk;

  /** Relevance rank (lower is better) */
  rank: number;
}

/**
 * Options for chunk search.
 */
export interface SearchOptions {
  /** Filter by session ID */
  sessionId?: string;

  /** Filter by minimum depth */
  depth?: number;

  /** Maximum number of results */
  limit?: number;
}

/**
 * Raw search result row from the database.
 */
interface SearchRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  depth: number;
  child_refs: string | null;
  content: string;
  summary: string | null;
  status: string;
  created_at: number;
  finalized_at: number | null;
  compacted_at: number | null;
  embedding: Uint8Array | null;
  rank: number;
}

/**
 * Converts a search row to a SearchResult.
 *
 * @param row - The raw database row
 * @returns The parsed SearchResult
 */
function rowToSearchResult(row: SearchRow): SearchResult {
  return {
    chunk: {
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id,
      depth: row.depth,
      childRefs: row.child_refs ? (JSON.parse(row.child_refs) as string[]) : null,
      content: JSON.parse(row.content) as ChunkContent,
      summary: row.summary,
      status: row.status as ChunkStatus,
      createdAt: row.created_at,
      finalizedAt: row.finalized_at,
      compactedAt: row.compacted_at,
      embedding: row.embedding,
    },
    rank: row.rank,
  };
}

/**
 * Service for managing chunks in the Memoir plugin.
 *
 * Provides high-level operations for chunk lifecycle management,
 * including creation, finalization, compaction, and search.
 *
 * @example
 * ```typescript
 * const service = initializeChunkService(db, config);
 *
 * // Create a chunk
 * const chunk = service.create('session_123', { messages: [], metadata: {} });
 *
 * // Finalize tracked messages into a chunk
 * const finalized = service.finalize('session_123');
 *
 * // Compact active chunks
 * const result = service.compact('session_123', 'Summary of work');
 * ```
 */
export class ChunkService {
  private repository: ChunkRepository;
  private config: ResolvedMemoirConfig;
  private db: DatabaseLike;

  constructor(db: DatabaseLike, config: ResolvedMemoirConfig) {
    this.db = db;
    this.repository = new ChunkRepository(db);
    this.config = config;
  }

  /**
   * Creates a new chunk with the given content.
   *
   * @param sessionId - The session ID
   * @param content - The chunk content
   * @returns The created chunk
   */
  create(sessionId: string, content: ChunkContent): Chunk {
    return this.repository.create({ sessionId, content });
  }

  /**
   * Finalizes tracked messages into a chunk.
   *
   * Creates a new chunk from the messages tracked by the MessageTracker,
   * sets the finalizedAt timestamp, and clears the tracked messages.
   *
   * @param sessionId - The session ID
   * @returns The finalized chunk, or null if no messages to finalize
   */
  finalize(sessionId: string): Chunk | null {
    const tracker = getMessageTracker();
    const messages = tracker.getMessages(sessionId);

    if (messages.length === 0) {
      return null;
    }

    // Extract metadata from messages
    const toolsUsed = new Set<string>();
    const filesModified = new Set<string>();

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'tool' && part.tool) {
          toolsUsed.add(part.tool);
        }
        if (part.type === 'file' && part.text) {
          filesModified.add(part.text);
        }
      }
    }

    const content: ChunkContent = {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        timestamp: m.timestamp,
      })),
      metadata: {
        tools_used: toolsUsed.size > 0 ? Array.from(toolsUsed) : undefined,
        files_modified: filesModified.size > 0 ? Array.from(filesModified) : undefined,
      },
    };

    // Create the chunk
    const chunk = this.repository.create({ sessionId, content });

    // Set finalized timestamp
    const now = Math.floor(Date.now() / 1000);
    const finalized = this.repository.update(chunk.id, { finalizedAt: now });

    // Clear tracked messages
    tracker.clearSession(sessionId);

    // Update current chunk ID
    if (finalized) {
      tracker.setCurrentChunkId(sessionId, finalized.id);
    }

    return finalized;
  }

  /**
   * Compacts active chunks into a summary chunk.
   *
   * Takes all active chunks for a session and compacts them into
   * a single summary chunk with the provided summary text.
   *
   * @param sessionId - The session ID
   * @param summary - The summary text for the compacted chunk
   * @returns The compaction result, or null if no active chunks
   */
  compact(sessionId: string, summary: string): CompactResult | null {
    const activeChunks = this.repository.getActiveChunks(sessionId);

    if (activeChunks.length === 0) {
      return null;
    }

    const chunkIds = activeChunks.map((c) => c.id);
    return compactChunks(this.db, sessionId, chunkIds, summary);
  }

  /**
   * Expands a chunk to get its full content and optionally descendants.
   *
   * @param chunkId - The chunk ID to expand
   * @param includeChildren - Whether to include descendant chunks
   * @returns Array of chunks (the chunk itself, and optionally its descendants)
   */
  expand(chunkId: string, includeChildren: boolean = false): Chunk[] {
    const chunk = this.repository.getById(chunkId);

    if (!chunk) {
      return [];
    }

    if (!includeChildren) {
      return [chunk];
    }

    // Get all descendants using tree traversal
    const descendants = getDescendants(this.db, chunkId);
    // Remove the level property
    return descendants.map((descendant): Chunk => {
      const { level, ...chunk } = descendant;
      void level; // Explicitly mark as intentionally unused
      return chunk;
    });
  }

  /**
   * Searches chunks using full-text search.
   *
   * @param query - The search query
   * @param options - Search options (sessionId, depth, limit)
   * @returns Array of search results with ranking
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    // Early return if query is empty or undefined
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const limit = options?.limit ?? this.config.memory.maxSearchResults;

    // Extract alphanumeric words only - safest approach for FTS5
    const words = query.match(/\b\w+\b/g);
    if (!words || words.length === 0) {
      return [];
    }

    // Filter out very short words and FTS5 operators
    const ftsOperators = new Set(['AND', 'OR', 'NOT', 'NEAR']);
    const validWords = words.filter((w) => w.length >= 2 && !ftsOperators.has(w.toUpperCase()));
    if (validWords.length === 0) {
      return [];
    }

    // Quote each word for literal matching, join with OR
    const ftsQuery = validWords.map((w) => `"${w}"`).join(' OR ');

    let sql = `
      SELECT c.*, fts.rank
      FROM chunks_fts fts
      JOIN chunks c ON c.rowid = fts.rowid
      WHERE chunks_fts MATCH ?
    `;

    const params: (string | number)[] = [ftsQuery];

    if (options?.sessionId) {
      sql += ' AND c.session_id = ?';
      params.push(options.sessionId);
    }

    if (options?.depth !== undefined) {
      sql += ' AND c.depth >= ?';
      params.push(options.depth);
    }

    sql += ' ORDER BY fts.rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as SearchRow[];

    return rows.map(rowToSearchResult);
  }

  /**
   * Gets all active chunks for a session.
   *
   * @param sessionId - The session ID
   * @returns Array of active chunks
   */
  getActiveChunks(sessionId: string): Chunk[] {
    return this.repository.getActiveChunks(sessionId);
  }

  /**
   * Gets a chunk by its ID.
   *
   * @param id - The chunk ID
   * @returns The chunk if found, null otherwise
   */
  get(id: string): Chunk | null {
    return this.repository.getById(id);
  }

  /**
   * Deletes a chunk by its ID.
   *
   * @param id - The chunk ID
   * @returns True if deleted, false if not found
   */
  delete(id: string): boolean {
    return this.repository.delete(id);
  }

  /**
   * Deletes all chunks for a session.
   *
   * @param sessionId - The session ID
   * @returns The number of chunks deleted
   */
  deleteSession(sessionId: string): number {
    const chunks = this.repository.getBySession(sessionId);
    let deleted = 0;

    for (const chunk of chunks) {
      if (this.repository.delete(chunk.id)) {
        deleted++;
      }
    }

    // Clear any tracked messages for this session
    const tracker = getMessageTracker();
    tracker.clearSession(sessionId);

    return deleted;
  }

  /**
   * Gets recent summary chunks across all sessions.
   *
   * Returns chunks that have been compacted (depth > 0) and have summaries,
   * ordered by creation time (most recent first). Useful for providing
   * context about recent work to the LLM.
   *
   * @param limit - Maximum number of chunks to return (default: 5)
   * @returns Array of recent summary chunks
   */
  getRecentSummaryChunks(limit: number = 5): Chunk[] {
    return this.repository.getRecentSummaryChunks(limit);
  }
}

/** Singleton instance of the chunk service */
let chunkService: ChunkService | null = null;

/**
 * Initializes the ChunkService singleton.
 *
 * Creates a new ChunkService instance with the provided database and config.
 * If already initialized, returns the existing instance.
 *
 * @param db - The database instance
 * @param config - The resolved configuration
 * @returns The ChunkService instance
 *
 * @example
 * ```typescript
 * const db = DatabaseService.get().getDatabase();
 * const config = ConfigService.get();
 * const service = initializeChunkService(db, config);
 * ```
 */
export function initializeChunkService(
  db: DatabaseLike,
  config: ResolvedMemoirConfig
): ChunkService {
  if (!chunkService) {
    chunkService = new ChunkService(db, config);
  }
  return chunkService;
}

/**
 * Gets the ChunkService singleton instance.
 *
 * @returns The ChunkService instance
 * @throws Error if the service has not been initialized
 *
 * @example
 * ```typescript
 * const service = getChunkService();
 * const chunk = service.get('ch_abc123');
 * ```
 */
export function getChunkService(): ChunkService {
  if (!chunkService) {
    throw new Error('ChunkService not initialized. Call initializeChunkService() first.');
  }
  return chunkService;
}

/**
 * Resets the ChunkService singleton.
 *
 * Primarily used for testing to ensure a clean state.
 *
 * @example
 * ```typescript
 * // In test teardown
 * resetChunkService();
 * ```
 */
export function resetChunkService(): void {
  chunkService = null;
}

// Re-export types and functions from submodules
export { ChunkRepository, type CreateChunkInput, type UpdateChunkInput } from './repository.ts';
export { getAncestors, getDescendants, getFullContext, compactChunks } from './tree.ts';
export type { ChunkWithLevel, CompactResult } from './tree.ts';
export { MessageTracker, getMessageTracker, resetMessageTracker } from './tracker.ts';
export type { TrackedMessage } from './tracker.ts';
