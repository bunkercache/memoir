-- Migration: 0001_initial_memories_table
-- Description: Initial schema with memories table, FTS, triggers, and indexes
-- Subsystem: memory

-- =============================================================================
-- MEMORIES TABLE
-- =============================================================================

-- Memories table for storing project-wide learnings and facts.
-- Supports categorization by type and optional tagging.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('preference', 'pattern', 'gotcha', 'fact', 'learned')),
  tags TEXT,
  source TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER,
  embedding BLOB
);

-- =============================================================================
-- FULL-TEXT SEARCH
-- =============================================================================

-- Full-text search virtual table for memories.
-- Uses porter stemming and unicode61 tokenizer for better search results.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  content=memories,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- =============================================================================
-- FTS SYNC TRIGGERS
-- =============================================================================

-- Trigger to sync FTS index after memory insert.
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

-- Trigger to sync FTS index after memory delete.
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
END;

-- Trigger to sync FTS index after memory update.
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Index for filtering memories by type.
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

-- Index for ordering memories by creation date.
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
