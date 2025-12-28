/**
 * Chunk Tree Operations
 *
 * Provides tree traversal and compaction operations for chunks.
 * Uses recursive CTEs for efficient ancestor/descendant queries.
 */

import type { DatabaseLike } from '../db/index.ts';
import type { Chunk, ChunkContent, ChunkStatus } from '../types.ts';
import { generateChunkId } from '../db/index.ts';

/**
 * A chunk with its level in the tree hierarchy.
 */
export interface ChunkWithLevel extends Chunk {
  /** Level in the tree (0 = starting chunk, increases for ancestors/descendants) */
  level: number;
}

/**
 * Result of a chunk compaction operation.
 */
export interface CompactResult {
  /** The newly created summary chunk */
  summaryChunk: Chunk;

  /** The chunks that were compacted */
  compactedChunks: Chunk[];
}

/**
 * Raw chunk row with level from the database.
 */
interface ChunkRowWithLevel {
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
  level: number;
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
 * Converts a database row with level to a ChunkWithLevel object.
 *
 * @param row - The raw database row with level
 * @returns The parsed ChunkWithLevel object
 */
function rowToChunkWithLevel(row: ChunkRowWithLevel): ChunkWithLevel {
  return {
    ...rowToChunk(row),
    level: row.level,
  };
}

/**
 * Gets all ancestors of a chunk using a recursive CTE.
 *
 * Returns chunks from the root (highest level) down to the starting chunk (level 0).
 * The level indicates how many steps up the tree from the starting chunk.
 *
 * @param db - The database instance
 * @param chunkId - The starting chunk ID
 * @returns Array of ancestors with their levels, ordered from root to starting chunk
 *
 * @example
 * ```typescript
 * const ancestors = getAncestors(db, 'ch_abc123');
 * // Returns [{ ...rootChunk, level: 2 }, { ...parentChunk, level: 1 }, { ...startChunk, level: 0 }]
 * ```
 */
export function getAncestors(db: DatabaseLike, chunkId: string): ChunkWithLevel[] {
  const stmt = db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, session_id, parent_id, depth, child_refs, content, summary, status,
             created_at, finalized_at, compacted_at, embedding, 0 as level
      FROM chunks WHERE id = ?
      UNION ALL
      SELECT c.id, c.session_id, c.parent_id, c.depth, c.child_refs, c.content, c.summary, c.status,
             c.created_at, c.finalized_at, c.compacted_at, c.embedding, a.level + 1
      FROM chunks c JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT * FROM ancestors ORDER BY level DESC
  `);

  const rows = stmt.all(chunkId) as ChunkRowWithLevel[];
  return rows.map(rowToChunkWithLevel);
}

/**
 * Gets all descendants of a chunk using a recursive CTE.
 *
 * Returns chunks from the starting chunk (level 0) down to all leaf descendants.
 * The level indicates how many steps down the tree from the starting chunk.
 *
 * @param db - The database instance
 * @param chunkId - The starting chunk ID
 * @returns Array of descendants with their levels, ordered by level ascending
 *
 * @example
 * ```typescript
 * const descendants = getDescendants(db, 'ch_abc123');
 * // Returns [{ ...startChunk, level: 0 }, { ...child1, level: 1 }, { ...grandchild, level: 2 }]
 * ```
 */
export function getDescendants(db: DatabaseLike, chunkId: string): ChunkWithLevel[] {
  const stmt = db.prepare(`
    WITH RECURSIVE descendants AS (
      SELECT id, session_id, parent_id, depth, child_refs, content, summary, status,
             created_at, finalized_at, compacted_at, embedding, 0 as level
      FROM chunks WHERE id = ?
      UNION ALL
      SELECT c.id, c.session_id, c.parent_id, c.depth, c.child_refs, c.content, c.summary, c.status,
             c.created_at, c.finalized_at, c.compacted_at, c.embedding, d.level + 1
      FROM chunks c JOIN descendants d ON c.parent_id = d.id
    )
    SELECT * FROM descendants ORDER BY level ASC
  `);

  const rows = stmt.all(chunkId) as ChunkRowWithLevel[];
  return rows.map(rowToChunkWithLevel);
}

/**
 * Gets the full context for a chunk (the chunk itself plus all its ancestors).
 *
 * This is useful for reconstructing the conversation history leading up to a chunk.
 * Returns chunks ordered from root to the specified chunk.
 *
 * @param db - The database instance
 * @param chunkId - The chunk ID
 * @returns Array of chunks from root to the specified chunk
 *
 * @example
 * ```typescript
 * const context = getFullContext(db, 'ch_abc123');
 * // Returns [rootChunk, parentChunk, targetChunk]
 * ```
 */
export function getFullContext(db: DatabaseLike, chunkId: string): Chunk[] {
  const ancestors = getAncestors(db, chunkId);
  // Remove the level property and return as Chunk[]
  return ancestors.map((ancestor): Chunk => {
    const { level, ...chunk } = ancestor;
    void level; // Explicitly mark as intentionally unused
    return chunk;
  });
}

/**
 * Compacts multiple chunks into a single summary chunk.
 *
 * This operation:
 * 1. Creates a new summary chunk with depth = max(children depths) + 1
 * 2. Updates all child chunks: sets parent_id, status='compacted', compacted_at
 * 3. Sets child_refs on the summary chunk
 *
 * Uses a transaction for atomicity.
 *
 * @param db - The database instance
 * @param sessionId - The session ID for the new summary chunk
 * @param chunkIds - Array of chunk IDs to compact
 * @param summary - The summary text for the new chunk
 * @returns The compaction result with summary chunk and compacted chunks
 * @throws Error if any chunk ID is not found
 *
 * @example
 * ```typescript
 * const result = compactChunks(db, 'session_123', ['ch_1', 'ch_2', 'ch_3'], 'Summary of work done');
 * console.log(result.summaryChunk.id); // 'ch_newSummary'
 * console.log(result.compactedChunks.length); // 3
 * ```
 */
export function compactChunks(
  db: DatabaseLike,
  sessionId: string,
  chunkIds: string[],
  summary: string
): CompactResult {
  if (chunkIds.length === 0) {
    throw new Error('Cannot compact empty chunk list');
  }

  // Fetch all chunks to compact
  const placeholders = chunkIds.map(() => '?').join(', ');
  const fetchStmt = db.prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`);
  const rows = fetchStmt.all(...chunkIds) as ChunkRow[];

  if (rows.length !== chunkIds.length) {
    const foundIds = new Set(rows.map((r) => r.id));
    const missingIds = chunkIds.filter((id) => !foundIds.has(id));
    throw new Error(`Chunks not found: ${missingIds.join(', ')}`);
  }

  // Calculate max depth
  const maxDepth = Math.max(...rows.map((r) => r.depth));
  const summaryDepth = maxDepth + 1;

  // Generate new chunk ID and timestamp
  const summaryId = generateChunkId();
  const now = Math.floor(Date.now() / 1000);

  // Create empty content for summary chunk
  const summaryContent: ChunkContent = {
    messages: [],
    metadata: {},
  };

  // Use transaction for atomicity
  const transaction = db.transaction(() => {
    // 1. Create the summary chunk
    const insertStmt = db.prepare(`
      INSERT INTO chunks (id, session_id, parent_id, depth, child_refs, content, summary, status, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', ?)
    `);
    insertStmt.run(
      summaryId,
      sessionId,
      summaryDepth,
      JSON.stringify(chunkIds),
      JSON.stringify(summaryContent),
      summary,
      now
    );

    // 2. Update all child chunks
    const updateStmt = db.prepare(`
      UPDATE chunks
      SET parent_id = ?, status = 'compacted', compacted_at = ?
      WHERE id = ?
    `);

    for (const chunkId of chunkIds) {
      updateStmt.run(summaryId, now, chunkId);
    }
  });

  transaction();

  // Fetch the created summary chunk
  const summaryStmt = db.prepare('SELECT * FROM chunks WHERE id = ?');
  const summaryRow = summaryStmt.get(summaryId) as ChunkRow;
  const summaryChunk = rowToChunk(summaryRow);

  // Fetch the updated compacted chunks
  const compactedStmt = db.prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`);
  const compactedRows = compactedStmt.all(...chunkIds) as ChunkRow[];
  const compactedChunks = compactedRows.map(rowToChunk);

  return {
    summaryChunk,
    compactedChunks,
  };
}
