-- Migration: 0001_initial_chunks_table
-- Description: Initial schema with chunks table, FTS, triggers, and indexes
-- Subsystem: history

-- =============================================================================
-- CHUNKS TABLE
-- =============================================================================

-- Chunks table for storing session history as a tree structure.
-- Supports hierarchical compaction with parent-child relationships.
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  child_refs TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'compacted', 'archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finalized_at INTEGER,
  compacted_at INTEGER,
  embedding BLOB
);

-- =============================================================================
-- FULL-TEXT SEARCH
-- =============================================================================

-- Full-text search virtual table for chunks.
-- Indexes both content and summary for comprehensive search.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  summary,
  content=chunks,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- =============================================================================
-- FTS SYNC TRIGGERS
-- =============================================================================

-- Trigger to sync FTS index after chunk insert.
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;

-- Trigger to sync FTS index after chunk delete.
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, summary) VALUES ('delete', old.rowid, old.content, old.summary);
END;

-- Trigger to sync FTS index after chunk update.
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, summary) VALUES ('delete', old.rowid, old.content, old.summary);
  INSERT INTO chunks_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Index for filtering chunks by session.
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);

-- Index for traversing chunk parent relationships.
CREATE INDEX IF NOT EXISTS idx_chunks_parent ON chunks(parent_id);

-- Index for filtering chunks by status.
CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);

-- Index for filtering chunks by depth level.
CREATE INDEX IF NOT EXISTS idx_chunks_depth ON chunks(depth);

-- Index for ordering chunks by creation date.
CREATE INDEX IF NOT EXISTS idx_chunks_created ON chunks(created_at DESC);
