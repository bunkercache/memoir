/**
 * Database Module Tests
 *
 * Tests for createDatabase and DatabaseService singleton.
 * Uses the database abstraction layer which supports both bun:sqlite
 * and better-sqlite3 (for Node.js/vitest with sqlite-vec support).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, DatabaseService } from './index.ts';

describe('Database Module', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'memoir-db-test-'));
    // Reset DatabaseService singleton between tests
    DatabaseService.reset();
  });

  afterEach(() => {
    // Ensure singleton is reset before cleanup
    DatabaseService.reset();
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createDatabase', () => {
    /**
     * Positive test: createDatabase should create a database file at the specified path.
     * Objective: Verify that calling createDatabase creates the SQLite file.
     */
    it('should create a database file at the specified path', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const db = createDatabase(dbPath);

      // Assert
      expect(existsSync(dbPath)).toBe(true);

      // Cleanup
      db.close();
    });

    /**
     * Positive test: createDatabase should enable WAL mode.
     * Objective: Verify that WAL journal mode is enabled for better concurrency.
     */
    it('should enable WAL mode', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const db = createDatabase(dbPath);
      const result = db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get();

      // Assert
      expect(result?.journal_mode).toBe('wal');

      // Cleanup
      db.close();
    });

    /**
     * Positive test: createDatabase should enable foreign keys.
     * Objective: Verify that foreign key constraints are enforced.
     */
    it('should enable foreign keys', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const db = createDatabase(dbPath);
      const result = db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get();

      // Assert
      expect(result?.foreign_keys).toBe(1);

      // Cleanup
      db.close();
    });

    /**
     * Positive test: createDatabase should run migrations.
     * Objective: Verify that migrations are applied during database creation.
     */
    it('should run migrations on creation', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const db = createDatabase(dbPath);

      // Assert - Check that tables exist
      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      const tableNames = tables.map((t) => t.name);

      // New migration system uses x_memory_migrations and x_history_migrations
      expect(tableNames).toContain('x_memory_migrations');
      expect(tableNames).toContain('x_history_migrations');
      expect(tableNames).toContain('memories');
      expect(tableNames).toContain('chunks');

      // Cleanup
      db.close();
    });

    /**
     * Positive test: createDatabase should create FTS tables.
     * Objective: Verify that full-text search virtual tables are created.
     */
    it('should create FTS virtual tables', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const db = createDatabase(dbPath);

      // Assert - Check that FTS tables exist
      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'")
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('memories_fts');
      expect(tableNames).toContain('chunks_fts');

      // Cleanup
      db.close();
    });

    /**
     * Positive test: createDatabase should be idempotent.
     * Objective: Verify that opening an existing database doesn't cause errors.
     */
    it('should open existing database without errors', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');
      const db1 = createDatabase(dbPath);
      db1.close();

      // Act
      const db2 = createDatabase(dbPath);

      // Assert - Should have migrations applied (check x_memory_migrations table)
      const result = db2
        .query<{ version: number }, []>('SELECT MAX(version) as version FROM x_memory_migrations')
        .get();
      expect(result?.version).toBeGreaterThan(0);

      // Cleanup
      db2.close();
    });
  });

  describe('DatabaseService', () => {
    /**
     * Positive test: DatabaseService.initialize should create singleton.
     * Objective: Verify that initialize creates a singleton instance.
     */
    it('should initialize and return same instance on subsequent calls', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');

      // Act
      const instance1 = DatabaseService.initialize(dbPath);
      const instance2 = DatabaseService.initialize(dbPath);

      // Assert
      expect(instance1).toBe(instance2);
    });

    /**
     * Positive test: DatabaseService.get should return initialized instance.
     * Objective: Verify that get() returns the singleton after initialization.
     */
    it('should return initialized instance via get()', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');
      const initialized = DatabaseService.initialize(dbPath);

      // Act
      const retrieved = DatabaseService.get();

      // Assert
      expect(retrieved).toBe(initialized);
    });

    /**
     * Negative test: DatabaseService.get should throw if not initialized.
     * Objective: Verify that accessing the service before initialization throws an error.
     */
    it('should throw if get() called before initialize()', () => {
      // Arrange - DatabaseService is reset in beforeEach

      // Act & Assert
      expect(() => DatabaseService.get()).toThrow(
        "DatabaseService 'default' not initialized. Call initialize() first."
      );
    });

    /**
     * Positive test: DatabaseService.reset should close connection and clear instance.
     * Objective: Verify that reset() properly cleans up the singleton.
     */
    it('should close connection and clear instance on reset()', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');
      DatabaseService.initialize(dbPath);

      // Act
      DatabaseService.reset();

      // Assert
      expect(() => DatabaseService.get()).toThrow();
    });

    /**
     * Positive test: DatabaseService.getDatabase should return the database instance.
     * Objective: Verify that getDatabase() provides access to the underlying database.
     */
    it('should provide access to database via getDatabase()', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');
      const service = DatabaseService.initialize(dbPath);

      // Act
      const db = service.getDatabase();

      // Assert
      expect(db).toBeDefined();
      // Verify it's a working database
      const result = db.query<{ value: number }, []>('SELECT 1 as value').get();
      expect(result?.value).toBe(1);
    });

    /**
     * Positive test: DatabaseService.getPath should return the database path.
     * Objective: Verify that getPath() returns the correct database file path.
     */
    it('should return database path via getPath()', () => {
      // Arrange
      const dbPath = join(tempDir, 'test.db');
      const service = DatabaseService.initialize(dbPath);

      // Act
      const path = service.getPath();

      // Assert
      expect(path).toBe(dbPath);
    });

    /**
     * Positive test: DatabaseService should allow re-initialization after reset.
     * Objective: Verify that the service can be re-initialized with a different path.
     */
    it('should allow re-initialization after reset', () => {
      // Arrange
      const dbPath1 = join(tempDir, 'test1.db');
      const dbPath2 = join(tempDir, 'test2.db');

      DatabaseService.initialize(dbPath1);
      DatabaseService.reset();

      // Act
      const service = DatabaseService.initialize(dbPath2);

      // Assert
      expect(service.getPath()).toBe(dbPath2);
      expect(existsSync(dbPath2)).toBe(true);
    });
  });
});
