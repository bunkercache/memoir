/**
 * Migration System Tests
 *
 * Tests for the new SQL-based migration system with subsystem support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Database } from 'bun:sqlite';
import { createRawDatabase } from './test-utils.ts';
import {
  getCurrentVersion,
  runMigrations,
  runAllMigrations,
  getMigrations,
  getAppliedMigrations,
  getPendingMigrations,
  validateMigrations,
  getMigrationTableName,
  parseFilename,
  computeChecksum,
  ensureMigrationTable,
} from './migrations/index.ts';

describe('Migration System', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'memoir-migrations-test-'));
  });

  afterEach(() => {
    // Close database if it was created
    if (db) {
      db.close();
    }
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseFilename', () => {
    it('should parse valid migration filenames', () => {
      const result = parseFilename('0001_initial_memories_table.sql');
      expect(result.version).toBe(1);
      expect(result.description).toBe('initial memories table');
    });

    it('should handle multi-digit versions', () => {
      const result = parseFilename('0123_add_new_column.sql');
      expect(result.version).toBe(123);
      expect(result.description).toBe('add new column');
    });

    it('should throw for invalid filenames', () => {
      expect(() => parseFilename('invalid.sql')).toThrow(/Invalid migration filename/);
      expect(() => parseFilename('01_too_short.sql')).toThrow(/Invalid migration filename/);
      expect(() => parseFilename('0001_no_extension')).toThrow(/Invalid migration filename/);
    });
  });

  describe('computeChecksum', () => {
    it('should return consistent checksums for same content', () => {
      const sql = 'CREATE TABLE test (id TEXT);';
      const checksum1 = computeChecksum(sql);
      const checksum2 = computeChecksum(sql);
      expect(checksum1).toBe(checksum2);
    });

    it('should return different checksums for different content', () => {
      const checksum1 = computeChecksum('CREATE TABLE a (id TEXT);');
      const checksum2 = computeChecksum('CREATE TABLE b (id TEXT);');
      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('getMigrationTableName', () => {
    it('should return correct table names for subsystems', () => {
      expect(getMigrationTableName('memory')).toBe('x_memory_migrations');
      expect(getMigrationTableName('history')).toBe('x_history_migrations');
    });
  });

  describe('getMigrations', () => {
    it('should return migrations for memory subsystem', () => {
      const migrations = getMigrations('memory');
      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0].subsystem).toBe('memory');
      expect(migrations[0].version).toBe(1);
    });

    it('should return migrations for history subsystem', () => {
      const migrations = getMigrations('history');
      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0].subsystem).toBe('history');
      expect(migrations[0].version).toBe(1);
    });

    it('should return migrations sorted by version', () => {
      const migrations = getMigrations('memory');
      for (let i = 1; i < migrations.length; i++) {
        expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
      }
    });
  });

  describe('getCurrentVersion', () => {
    it('should return 0 for new database without migration table', () => {
      db = createRawDatabase();
      expect(getCurrentVersion(db, 'memory')).toBe(0);
      expect(getCurrentVersion(db, 'history')).toBe(0);
    });

    it('should return 0 for empty migration table', () => {
      db = createRawDatabase();
      ensureMigrationTable(db, 'memory');
      expect(getCurrentVersion(db, 'memory')).toBe(0);
    });

    it('should return highest version number', () => {
      db = createRawDatabase();
      ensureMigrationTable(db, 'memory');
      const tableName = getMigrationTableName('memory');
      db.run(
        `INSERT INTO ${tableName} (version, filename, checksum) VALUES (1, 'test1.sql', 'abc')`
      );
      db.run(
        `INSERT INTO ${tableName} (version, filename, checksum) VALUES (3, 'test3.sql', 'def')`
      );
      db.run(
        `INSERT INTO ${tableName} (version, filename, checksum) VALUES (2, 'test2.sql', 'ghi')`
      );
      expect(getCurrentVersion(db, 'memory')).toBe(3);
    });
  });

  describe('runMigrations', () => {
    it('should apply all migrations for memory subsystem', () => {
      db = createRawDatabase();
      const applied = runMigrations(db, 'memory');
      expect(applied).toBeGreaterThan(0);

      // Verify migration table exists
      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name='x_memory_migrations'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('should apply all migrations for history subsystem', () => {
      db = createRawDatabase();
      const applied = runMigrations(db, 'history');
      expect(applied).toBeGreaterThan(0);

      // Verify migration table exists
      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name='x_history_migrations'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('should be idempotent', () => {
      db = createRawDatabase();
      const applied1 = runMigrations(db, 'memory');
      const applied2 = runMigrations(db, 'memory');

      expect(applied1).toBeGreaterThan(0);
      expect(applied2).toBe(0); // No new migrations to apply
    });

    it('should create memories table with correct schema', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');

      const columns = db.query<{ name: string }, []>('PRAGMA table_info(memories)').all();
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('tags');
      expect(columnNames).toContain('source');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
      expect(columnNames).toContain('embedding');
    });

    it('should create chunks table with correct schema', () => {
      db = createRawDatabase();
      runMigrations(db, 'history');

      const columns = db.query<{ name: string }, []>('PRAGMA table_info(chunks)').all();
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('session_id');
      expect(columnNames).toContain('parent_id');
      expect(columnNames).toContain('depth');
      expect(columnNames).toContain('child_refs');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('summary');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('finalized_at');
      expect(columnNames).toContain('compacted_at');
      expect(columnNames).toContain('embedding');
    });

    it('should create FTS virtual tables', () => {
      db = createRawDatabase();
      runAllMigrations(db);

      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'")
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('memories_fts');
      expect(tableNames).toContain('chunks_fts');
    });

    it('should create indexes', () => {
      db = createRawDatabase();
      runAllMigrations(db);

      const indexes = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all();
      const indexNames = indexes.map((i) => i.name);

      // Memory indexes
      expect(indexNames).toContain('idx_memories_type');
      expect(indexNames).toContain('idx_memories_created');

      // Chunk indexes
      expect(indexNames).toContain('idx_chunks_session');
      expect(indexNames).toContain('idx_chunks_parent');
      expect(indexNames).toContain('idx_chunks_status');
      expect(indexNames).toContain('idx_chunks_depth');
      expect(indexNames).toContain('idx_chunks_created');
    });

    it('should create FTS sync triggers', () => {
      db = createRawDatabase();
      runAllMigrations(db);

      const triggers = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='trigger'")
        .all();
      const triggerNames = triggers.map((t) => t.name);

      // Memory triggers
      expect(triggerNames).toContain('memories_ai');
      expect(triggerNames).toContain('memories_ad');
      expect(triggerNames).toContain('memories_au');

      // Chunk triggers
      expect(triggerNames).toContain('chunks_ai');
      expect(triggerNames).toContain('chunks_ad');
      expect(triggerNames).toContain('chunks_au');
    });
  });

  describe('runAllMigrations', () => {
    it('should apply migrations for both subsystems', () => {
      db = createRawDatabase();
      const result = runAllMigrations(db);

      expect(result.memory).toBeGreaterThan(0);
      expect(result.history).toBeGreaterThan(0);

      // Both migration tables should exist
      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'x_%_migrations'")
        .all();
      expect(tables.length).toBe(2);
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return empty array for new database', () => {
      db = createRawDatabase();
      expect(getAppliedMigrations(db, 'memory')).toEqual([]);
    });

    it('should return applied migrations after running', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');

      const applied = getAppliedMigrations(db, 'memory');
      expect(applied.length).toBeGreaterThan(0);
      expect(applied[0]).toHaveProperty('version');
      expect(applied[0]).toHaveProperty('filename');
      expect(applied[0]).toHaveProperty('applied_at');
      expect(applied[0]).toHaveProperty('checksum');
    });
  });

  describe('getPendingMigrations', () => {
    it('should return all migrations for new database', () => {
      db = createRawDatabase();
      const pending = getPendingMigrations(db, 'memory');
      const all = getMigrations('memory');
      expect(pending.length).toBe(all.length);
    });

    it('should return empty array after all migrations applied', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');
      const pending = getPendingMigrations(db, 'memory');
      expect(pending.length).toBe(0);
    });
  });

  describe('validateMigrations', () => {
    it('should return empty array when checksums match', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');
      const mismatches = validateMigrations(db, 'memory');
      expect(mismatches.length).toBe(0);
    });

    it('should detect checksum mismatches', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');

      // Tamper with the checksum
      const tableName = getMigrationTableName('memory');
      db.run(`UPDATE ${tableName} SET checksum = 'tampered' WHERE version = 1`);

      const mismatches = validateMigrations(db, 'memory');
      expect(mismatches.length).toBe(1);
      expect(mismatches[0].expectedChecksum).toBe('tampered');
    });
  });

  describe('FTS functionality', () => {
    it('should enable FTS search on memories', () => {
      db = createRawDatabase();
      runMigrations(db, 'memory');

      db.run(
        "INSERT INTO memories (id, content, type, source) VALUES ('mem_test1', 'Always use TypeScript strict mode', 'preference', 'user')"
      );
      db.run(
        "INSERT INTO memories (id, content, type, source) VALUES ('mem_test2', 'Prefer functional programming patterns', 'pattern', 'user')"
      );

      const results = db
        .query<
          { id: string },
          []
        >("SELECT id FROM memories WHERE rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'TypeScript')")
        .all();

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('mem_test1');
    });

    it('should enable FTS search on chunks', () => {
      db = createRawDatabase();
      runMigrations(db, 'history');

      db.run(
        "INSERT INTO chunks (id, session_id, content, status) VALUES ('ch_test1', 'session1', 'Implemented user authentication', 'active')"
      );
      db.run(
        "INSERT INTO chunks (id, session_id, content, status) VALUES ('ch_test2', 'session1', 'Fixed database connection issue', 'active')"
      );

      const results = db
        .query<
          { id: string },
          []
        >("SELECT id FROM chunks WHERE rowid IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'authentication')")
        .all();

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ch_test1');
    });
  });

  describe('subsystem isolation', () => {
    it('should track migrations independently per subsystem', () => {
      db = createRawDatabase();

      // Apply only memory migrations
      runMigrations(db, 'memory');

      expect(getCurrentVersion(db, 'memory')).toBeGreaterThan(0);
      expect(getCurrentVersion(db, 'history')).toBe(0);

      // Apply history migrations
      runMigrations(db, 'history');

      expect(getCurrentVersion(db, 'memory')).toBeGreaterThan(0);
      expect(getCurrentVersion(db, 'history')).toBeGreaterThan(0);
    });

    it('should allow separate databases for each subsystem', () => {
      const memoryDb = createRawDatabase();
      const historyDb = createRawDatabase();

      runMigrations(memoryDb, 'memory');
      runMigrations(historyDb, 'history');

      // Memory db should have memories table but not chunks
      const memoryTables = memoryDb
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memories', 'chunks')")
        .all();
      expect(memoryTables.map((t) => t.name)).toContain('memories');
      expect(memoryTables.map((t) => t.name)).not.toContain('chunks');

      // History db should have chunks table but not memories
      const historyTables = historyDb
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memories', 'chunks')")
        .all();
      expect(historyTables.map((t) => t.name)).toContain('chunks');
      expect(historyTables.map((t) => t.name)).not.toContain('memories');

      memoryDb.close();
      historyDb.close();
    });
  });
});
