/**
 * Test Utilities for Database Operations
 *
 * Provides helper functions for creating test databases using bun:sqlite.
 */

import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { createDatabase } from './index.ts';

// =============================================================================
// SQLITE CONFIGURATION
// =============================================================================

const SQLITE_PATHS = [
  '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
  '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
];

let sqliteConfigured = false;

function configureCustomSQLite(): void {
  if (sqliteConfigured) return;

  for (const path of SQLITE_PATHS) {
    if (existsSync(path)) {
      try {
        Database.setCustomSQLite(path);
        sqliteConfigured = true;
        return;
      } catch {
        // Failed to set custom SQLite, try next path
      }
    }
  }
}

// =============================================================================
// TEST DATABASE CREATION
// =============================================================================

/**
 * Result of creating a test database.
 */
export interface TestDatabaseResult {
  /** The database connection */
  db: Database;

  /** Path to the temporary directory containing the database */
  tempDir: string;

  /** Full path to the database file */
  dbPath: string;
}

/**
 * Create a test database with migrations applied.
 *
 * The database is created in a temporary directory with all migrations applied.
 *
 * @returns TestDatabaseResult with db, tempDir, and dbPath
 *
 * @example
 * ```typescript
 * import { createTestDatabase } from '../db/test-utils.ts';
 *
 * const { db, tempDir, dbPath } = createTestDatabase();
 * // Use db for testing...
 * db.close();
 * rmSync(tempDir, { recursive: true, force: true });
 * ```
 */
export function createTestDatabase(): TestDatabaseResult {
  const tempDir = mkdtempSync(join(tmpdir(), 'memoir-test-'));
  const dbPath = join(tempDir, 'test.db');
  const db = createDatabase(dbPath);

  return { db, tempDir, dbPath };
}

/**
 * Create a raw database WITHOUT running migrations.
 *
 * This is useful for testing migration logic itself, where you need
 * a fresh database without any schema applied.
 *
 * @returns A Database instance with no migrations applied
 *
 * @example
 * ```typescript
 * import { createRawDatabase } from '../db/test-utils.ts';
 *
 * const db = createRawDatabase();
 * // Test migration logic...
 * db.close();
 * ```
 */
export function createRawDatabase(): Database {
  /* eslint-disable no-console */
  configureCustomSQLite();

  const db = new Database(':memory:');

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  // Try to load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch {
    console.warn('[memoir] sqlite-vec extension not available, vector search disabled');
  }

  return db;
  /* eslint-enable no-console */
}
