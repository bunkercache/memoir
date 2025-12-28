/**
 * Memory Repository
 *
 * Provides CRUD operations for memory entries in the database.
 * Uses prepared statements for optimal performance.
 */

import type { DatabaseLike, StatementLike } from '../db/index.ts';
import type { Memory, MemoryType, MemorySource } from '../types.ts';
import { generateMemoryId } from '../db/ids.ts';

/**
 * Input for creating a new memory entry.
 */
export interface CreateMemoryInput {
  /** The memory content text */
  content: string;

  /** Category of the memory */
  type: MemoryType;

  /** Optional tags for categorization */
  tags?: string[];

  /** How this memory was created (defaults to 'user') */
  source?: MemorySource;
}

/**
 * Input for updating an existing memory entry.
 */
export interface UpdateMemoryInput {
  /** Updated content text */
  content?: string;

  /** Updated category */
  type?: MemoryType;

  /** Updated tags */
  tags?: string[];
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
 * Raw database row structure for memories.
 */
interface MemoryRow {
  id: string;
  content: string;
  type: string;
  tags: string | null;
  source: string | null;
  created_at: number;
  updated_at: number | null;
  embedding: Uint8Array | null;
}

/**
 * Converts a database row to a Memory object.
 *
 * @param row - The raw database row
 * @returns A Memory object with camelCase properties
 */
function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    type: row.type as MemoryType,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
    source: (row.source as MemorySource) || 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embedding: row.embedding,
  };
}

/**
 * Repository for memory CRUD operations.
 *
 * Provides methods for creating, reading, updating, and deleting memories.
 * Uses prepared statements for optimal database performance.
 *
 * @example
 * ```typescript
 * const repo = new MemoryRepository(db);
 *
 * // Create a memory
 * const memory = repo.create({
 *   content: 'Always use strict TypeScript mode',
 *   type: 'preference',
 *   tags: ['typescript', 'config']
 * });
 *
 * // Search and list
 * const memories = repo.list({ type: 'preference', limit: 10 });
 * ```
 */
export class MemoryRepository {
  private readonly db: DatabaseLike;

  // Prepared statements for performance
  private readonly insertStmt: StatementLike<unknown>;
  private readonly selectByIdStmt: StatementLike<MemoryRow>;
  private readonly deleteStmt: StatementLike<unknown>;
  private readonly countAllStmt: StatementLike<{ count: number }>;

  /**
   * Creates a new MemoryRepository instance.
   *
   * @param db - The database connection to use
   */
  constructor(db: DatabaseLike) {
    this.db = db;

    // Prepare commonly used statements
    this.insertStmt = db.prepare(`
      INSERT INTO memories (id, content, type, tags, source, created_at)
      VALUES ($id, $content, $type, $tags, $source, $createdAt)
    `);

    this.selectByIdStmt = db.prepare<MemoryRow, [string]>(`
      SELECT id, content, type, tags, source, created_at, updated_at, embedding
      FROM memories
      WHERE id = ?
    `);

    this.deleteStmt = db.prepare(`
      DELETE FROM memories WHERE id = ?
    `);

    this.countAllStmt = db.prepare<{ count: number }, []>(`
      SELECT COUNT(*) as count FROM memories
    `);
  }

  /**
   * Creates a new memory entry.
   *
   * @param input - The memory creation input
   * @returns The created Memory object
   */
  create(input: CreateMemoryInput): Memory {
    const id = generateMemoryId();
    const createdAt = Math.floor(Date.now() / 1000);
    const tags = input.tags ? JSON.stringify(input.tags) : null;
    const source = input.source || 'user';

    this.insertStmt.run({
      $id: id,
      $content: input.content,
      $type: input.type,
      $tags: tags,
      $source: source,
      $createdAt: createdAt,
    });

    return {
      id,
      content: input.content,
      type: input.type,
      tags: input.tags || null,
      source,
      createdAt,
      updatedAt: null,
      embedding: null,
    };
  }

  /**
   * Retrieves a memory by its ID.
   *
   * @param id - The memory ID to look up
   * @returns The Memory object, or null if not found
   */
  getById(id: string): Memory | null {
    const row = this.selectByIdStmt.get(id) as MemoryRow | null;
    if (!row) {
      return null;
    }
    return rowToMemory(row);
  }

  /**
   * Updates an existing memory entry.
   *
   * @param id - The memory ID to update
   * @param input - The fields to update
   * @returns The updated Memory object, or null if not found
   */
  update(id: string, input: UpdateMemoryInput): Memory | null {
    // First check if the memory exists
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    // Build dynamic update query
    const updates: string[] = [];
    const params: Record<string, string | number | null> = { $id: id };

    if (input.content !== undefined) {
      updates.push('content = $content');
      params.$content = input.content;
    }

    if (input.type !== undefined) {
      updates.push('type = $type');
      params.$type = input.type;
    }

    if (input.tags !== undefined) {
      updates.push('tags = $tags');
      params.$tags = JSON.stringify(input.tags);
    }

    // Always update the updated_at timestamp
    updates.push('updated_at = $updatedAt');
    params.$updatedAt = Math.floor(Date.now() / 1000);

    if (updates.length === 0) {
      return existing;
    }

    const sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = $id`;
    this.db.query(sql).run(params);

    // Return the updated memory
    return this.getById(id);
  }

  /**
   * Deletes a memory by its ID.
   *
   * @param id - The memory ID to delete
   * @returns True if the memory was deleted, false if not found
   */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  /**
   * Lists memories with optional filtering and pagination.
   *
   * @param options - Filtering and pagination options
   * @returns Array of Memory objects
   */
  list(options?: ListMemoriesOptions): Memory[] {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const type = options?.type;

    let sql = `
      SELECT id, content, type, tags, source, created_at, updated_at, embedding
      FROM memories
    `;
    const params: (string | number)[] = [];

    if (type) {
      sql += ' WHERE type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.query(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  /**
   * Counts the total number of memories.
   *
   * @param type - Optional type filter
   * @returns The count of memories
   */
  count(type?: MemoryType): number {
    if (type) {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE type = ?');
      const result = stmt.get(type) as { count: number };
      return result.count;
    }

    const result = this.countAllStmt.get() as { count: number };
    return result.count;
  }
}
