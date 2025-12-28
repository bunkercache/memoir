/**
 * Chunk Repository
 *
 * Provides CRUD operations for chunk entities in the database.
 * Handles JSON serialization/deserialization for content and childRefs fields.
 */

import type { DatabaseLike } from '../db/index.ts';
import type { Chunk, ChunkContent, ChunkStatus } from '../types.ts';
import { generateChunkId } from '../db/index.ts';

/**
 * Input for creating a new chunk.
 */
export interface CreateChunkInput {
  /** Session this chunk belongs to */
  sessionId: string;

  /** The chunk content containing messages and metadata */
  content: ChunkContent;

  /** Parent chunk ID (null for root chunks) */
  parentId?: string;

  /** Depth in the chunk tree (0 for leaf chunks) */
  depth?: number;

  /** Summary text (for compacted chunks) */
  summary?: string;
}

/**
 * Input for updating an existing chunk.
 */
export interface UpdateChunkInput {
  /** Updated content */
  content?: ChunkContent;

  /** Updated summary */
  summary?: string;

  /** Updated status */
  status?: ChunkStatus;

  /** Updated child references */
  childRefs?: string[];

  /** Timestamp when chunk was finalized */
  finalizedAt?: number;

  /** Timestamp when chunk was compacted */
  compactedAt?: number;
}

/**
 * Raw chunk row from the database.
 */
interface ChunkRow {
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
}

/**
 * Converts a database row to a Chunk object.
 *
 * @param row - The raw database row
 * @returns The parsed Chunk object
 */
function rowToChunk(row: ChunkRow): Chunk {
  return {
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
  };
}

/**
 * Repository for chunk CRUD operations.
 *
 * Provides methods for creating, reading, updating, and deleting chunks.
 * Handles JSON serialization for content and childRefs fields.
 *
 * @example
 * ```typescript
 * const repo = new ChunkRepository(db);
 * const chunk = repo.create({
 *   sessionId: 'session_123',
 *   content: { messages: [], metadata: {} }
 * });
 * ```
 */
export class ChunkRepository {
  private db: DatabaseLike;

  constructor(db: DatabaseLike) {
    this.db = db;
  }

  /**
   * Creates a new chunk in the database.
   *
   * @param input - The chunk creation input
   * @returns The created chunk
   */
  create(input: CreateChunkInput): Chunk {
    const id = generateChunkId();
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, session_id, parent_id, depth, content, summary, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `);

    stmt.run(
      id,
      input.sessionId,
      input.parentId ?? null,
      input.depth ?? 0,
      JSON.stringify(input.content),
      input.summary ?? null,
      now
    );

    return {
      id,
      sessionId: input.sessionId,
      parentId: input.parentId ?? null,
      depth: input.depth ?? 0,
      childRefs: null,
      content: input.content,
      summary: input.summary ?? null,
      status: 'active',
      createdAt: now,
      finalizedAt: null,
      compactedAt: null,
      embedding: null,
    };
  }

  /**
   * Retrieves a chunk by its ID.
   *
   * @param id - The chunk ID
   * @returns The chunk if found, null otherwise
   */
  getById(id: string): Chunk | null {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE id = ?');
    const row = stmt.get(id) as ChunkRow | null;

    if (!row) {
      return null;
    }

    return rowToChunk(row);
  }

  /**
   * Updates an existing chunk.
   *
   * @param id - The chunk ID to update
   * @param input - The fields to update
   * @returns The updated chunk if found, null otherwise
   */
  update(id: string, input: UpdateChunkInput): Chunk | null {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.content !== undefined) {
      updates.push('content = ?');
      values.push(JSON.stringify(input.content));
    }

    if (input.summary !== undefined) {
      updates.push('summary = ?');
      values.push(input.summary);
    }

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }

    if (input.childRefs !== undefined) {
      updates.push('child_refs = ?');
      values.push(JSON.stringify(input.childRefs));
    }

    if (input.finalizedAt !== undefined) {
      updates.push('finalized_at = ?');
      values.push(input.finalizedAt);
    }

    if (input.compactedAt !== undefined) {
      updates.push('compacted_at = ?');
      values.push(input.compactedAt);
    }

    if (updates.length === 0) {
      return existing;
    }

    values.push(id);
    const stmt = this.db.prepare(`UPDATE chunks SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getById(id);
  }

  /**
   * Deletes a chunk by its ID.
   *
   * @param id - The chunk ID to delete
   * @returns True if the chunk was deleted, false if not found
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM chunks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Retrieves all chunks for a session, optionally filtered by status.
   *
   * @param sessionId - The session ID
   * @param options - Optional filter options
   * @returns Array of chunks for the session
   */
  getBySession(sessionId: string, options?: { status?: ChunkStatus }): Chunk[] {
    let query = 'SELECT * FROM chunks WHERE session_id = ?';
    const params: (string | number)[] = [sessionId];

    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY created_at ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as ChunkRow[];

    return rows.map(rowToChunk);
  }

  /**
   * Retrieves all active chunks for a session.
   *
   * @param sessionId - The session ID
   * @returns Array of active chunks
   */
  getActiveChunks(sessionId: string): Chunk[] {
    return this.getBySession(sessionId, { status: 'active' });
  }

  /**
   * Retrieves all children of a parent chunk.
   *
   * @param parentId - The parent chunk ID
   * @returns Array of child chunks
   */
  getChildren(parentId: string): Chunk[] {
    const stmt = this.db.prepare(
      'SELECT * FROM chunks WHERE parent_id = ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(parentId) as ChunkRow[];

    return rows.map(rowToChunk);
  }

  /**
   * Counts chunks, optionally filtered by session.
   *
   * @param sessionId - Optional session ID to filter by
   * @returns The count of chunks
   */
  count(sessionId?: string): number {
    if (sessionId) {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks WHERE session_id = ?');
      const result = stmt.get(sessionId) as { count: number };
      return result.count;
    }

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Retrieves recent chunks that have summaries (depth > 0).
   *
   * These are compacted summary chunks that provide an overview of past work.
   * Ordered by creation time descending (most recent first).
   *
   * @param limit - Maximum number of chunks to return (default: 5)
   * @returns Array of summary chunks
   */
  getRecentSummaryChunks(limit: number = 5): Chunk[] {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks
      WHERE depth > 0 AND summary IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as ChunkRow[];

    return rows.map(rowToChunk);
  }
}
