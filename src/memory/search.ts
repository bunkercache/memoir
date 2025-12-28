/**
 * Memory Search Functions
 *
 * Provides full-text search functionality for memories using SQLite FTS5.
 * Uses BM25 ranking for relevance scoring.
 */

import type { DatabaseLike } from '../db/index.ts';
import type { Memory, MemoryType } from '../types.ts';

/**
 * A search result containing a memory and its relevance rank.
 */
export interface SearchResult {
  /** The matched memory */
  memory: Memory;

  /** BM25 relevance score (lower is more relevant) */
  rank: number;
}

/**
 * Options for memory search.
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  limit?: number;

  /** Filter by memory type */
  type?: MemoryType;
}

/**
 * Raw database row structure for search results.
 */
interface SearchRow {
  id: string;
  content: string;
  type: string;
  tags: string | null;
  source: string | null;
  created_at: number;
  updated_at: number | null;
  embedding: Uint8Array | null;
  rank: number;
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
    source: (row.source as Memory['source']) || 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embedding: row.embedding,
  };
}

/**
 * Escapes special FTS5 characters in a search query.
 *
 * FTS5 uses special characters for operators. This function escapes them
 * to allow literal searching. Words are joined with OR to match any word.
 *
 * @param query - The raw search query
 * @returns The escaped query safe for FTS5
 */
function escapeFtsQuery(query: string): string {
  // Extract alphanumeric words only - this is the safest approach for FTS5
  // FTS5 has complex syntax with operators (AND, OR, NOT, NEAR) and special chars
  // By extracting only word characters, we avoid all syntax issues
  const words = query.match(/\b\w+\b/g);

  if (!words || words.length === 0) {
    return '';
  }

  // Filter out very short words and FTS5 operators
  const ftsOperators = new Set(['AND', 'OR', 'NOT', 'NEAR']);
  const validWords = words.filter((w) => w.length >= 2 && !ftsOperators.has(w.toUpperCase()));

  if (validWords.length === 0) {
    return '';
  }

  // Quote each word to ensure literal matching, escape any internal quotes
  // Then join with OR for broader matching
  return validWords.map((w) => `"${w}"`).join(' OR ');
}

/**
 * Searches memories using full-text search with BM25 ranking.
 *
 * Uses SQLite FTS5 to search memory content and tags.
 * Results are ranked by relevance using the BM25 algorithm.
 *
 * @param db - The database connection
 * @param query - The search query string
 * @param options - Search options (limit, type filter)
 * @returns Array of SearchResult objects sorted by relevance
 *
 * @example
 * ```typescript
 * const results = searchMemories(db, 'typescript strict mode');
 * for (const { memory, rank } of results) {
 *   console.log(`[${rank.toFixed(2)}] ${memory.content}`);
 * }
 * ```
 */
export function searchMemories(
  db: DatabaseLike,
  query: string,
  options?: SearchOptions
): SearchResult[] {
  // Early return if query is empty or undefined
  if (!query || typeof query !== 'string') {
    return [];
  }

  const limit = options?.limit ?? 20;
  const type = options?.type;

  // Escape and prepare the query
  const escapedQuery = escapeFtsQuery(query);
  if (!escapedQuery) {
    return [];
  }

  // Build the SQL query with optional type filter
  let sql = `
    SELECT m.id, m.content, m.type, m.tags, m.source,
           m.created_at, m.updated_at, m.embedding,
           bm25(memories_fts) as rank
    FROM memories_fts
    JOIN memories m ON memories_fts.rowid = m.rowid
    WHERE memories_fts MATCH ?
  `;
  const params: (string | number)[] = [escapedQuery];

  if (type) {
    sql += ' AND m.type = ?';
    params.push(type);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  const rows = db.query(sql).all(...params) as SearchRow[];

  return rows.map((row) => ({
    memory: rowToMemory(row),
    rank: row.rank,
  }));
}

/**
 * Retrieves memories filtered by type.
 *
 * @param db - The database connection
 * @param type - The memory type to filter by
 * @param options - Options (limit)
 * @returns Array of Memory objects
 *
 * @example
 * ```typescript
 * const preferences = searchByType(db, 'preference', { limit: 10 });
 * ```
 */
export function searchByType(
  db: DatabaseLike,
  type: MemoryType,
  options?: { limit?: number }
): Memory[] {
  const limit = options?.limit ?? 20;

  const sql = `
    SELECT id, content, type, tags, source, created_at, updated_at, embedding
    FROM memories
    WHERE type = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(type, limit) as MemoryRow[];
  return rows.map(rowToMemory);
}

/**
 * Retrieves the most recently created memories.
 *
 * @param db - The database connection
 * @param limit - Maximum number of memories to return (default: 10)
 * @returns Array of Memory objects sorted by creation date (newest first)
 *
 * @example
 * ```typescript
 * const recent = getRecentMemories(db, 5);
 * ```
 */
export function getRecentMemories(db: DatabaseLike, limit: number = 10): Memory[] {
  const sql = `
    SELECT id, content, type, tags, source, created_at, updated_at, embedding
    FROM memories
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(limit) as MemoryRow[];
  return rows.map(rowToMemory);
}
