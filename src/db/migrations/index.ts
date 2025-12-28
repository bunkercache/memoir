/**
 * Database Migration System for Memoir
 *
 * Provides versioned migrations for schema changes with support for separate
 * subsystems (memory, history) that can run independently.
 *
 * Each subsystem tracks its migrations in a dedicated table:
 * - x_memory_migrations - tracks memory subsystem migrations
 * - x_history_migrations - tracks history subsystem migrations
 *
 * Migrations are stored as pure SQL files with 4-digit prefixes:
 * - src/db/migrations/memory/0001_initial_memories_table.sql
 * - src/db/migrations/history/0001_initial_chunks_table.sql
 *
 * At build time, SQL files are embedded into the distributed package.
 */

import type { Database } from 'bun:sqlite';
import { EMBEDDED_MIGRATIONS, type MigrationSubsystem } from './embedded.ts';

// Re-export the type from embedded.ts (source of truth to avoid circular imports)
export type { MigrationSubsystem } from './embedded.ts';

/**
 * A parsed migration from a SQL file.
 */
export interface Migration {
  /** Migration version number extracted from filename (e.g., 0001 -> 1) */
  version: number;

  /** Original filename (e.g., "0001_initial_memories_table.sql") */
  filename: string;

  /** Human-readable description extracted from filename */
  description: string;

  /** The SQL content to execute */
  sql: string;

  /** The subsystem this migration belongs to */
  subsystem: MigrationSubsystem;
}

/**
 * Record of an applied migration stored in the database.
 */
export interface AppliedMigration {
  version: number;
  filename: string;
  applied_at: number;
  checksum: string;
}

// =============================================================================
// MIGRATION TABLE MANAGEMENT
// =============================================================================

/**
 * Gets the migration table name for a subsystem.
 */
export function getMigrationTableName(subsystem: MigrationSubsystem): string {
  return `x_${subsystem}_migrations`;
}

/**
 * Creates the migration tracking table for a subsystem if it doesn't exist.
 */
export function ensureMigrationTable(db: Database, subsystem: MigrationSubsystem): void {
  const tableName = getMigrationTableName(subsystem);
  db.run(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
      checksum TEXT NOT NULL
    );
  `);
}

/**
 * Simple checksum for migration content to detect modifications.
 */
export function computeChecksum(sql: string): string {
  // Use a simple hash - Bun's native hash is fast
  const hash = Bun.hash(sql);
  return hash.toString(16);
}

// =============================================================================
// MIGRATION LOADING
// =============================================================================

/**
 * Parses a migration filename into version and description.
 *
 * @param filename - Filename like "0001_initial_memories_table.sql"
 * @returns Parsed version and description
 */
export function parseFilename(filename: string): { version: number; description: string } {
  const match = filename.match(/^(\d{4})_(.+)\.sql$/);
  if (!match) {
    throw new Error(
      `Invalid migration filename: ${filename}. Expected format: 0001_description.sql`
    );
  }

  const version = parseInt(match[1], 10);
  const description = match[2].replace(/_/g, ' ');

  return { version, description };
}

/**
 * Gets all migrations for a subsystem from embedded SQL.
 * Migrations are sorted by version number.
 */
export function getMigrations(subsystem: MigrationSubsystem): Migration[] {
  const embedded = EMBEDDED_MIGRATIONS[subsystem];
  if (!embedded) {
    return [];
  }

  const migrations: Migration[] = [];

  for (const [filename, sql] of Object.entries(embedded)) {
    const { version, description } = parseFilename(filename);
    migrations.push({
      version,
      filename,
      description,
      sql,
      subsystem,
    });
  }

  // Sort by version
  return migrations.sort((a, b) => a.version - b.version);
}

// =============================================================================
// MIGRATION EXECUTION
// =============================================================================

/**
 * Gets the current schema version for a subsystem.
 *
 * @param db - The database connection
 * @param subsystem - The subsystem to check
 * @returns The highest applied migration version, or 0 if none applied
 */
export function getCurrentVersion(db: Database, subsystem: MigrationSubsystem): number {
  const tableName = getMigrationTableName(subsystem);

  try {
    const result = db
      .query<{ version: number }, []>(`SELECT MAX(version) as version FROM ${tableName}`)
      .get();
    return result?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Gets all applied migrations for a subsystem.
 */
export function getAppliedMigrations(
  db: Database,
  subsystem: MigrationSubsystem
): AppliedMigration[] {
  const tableName = getMigrationTableName(subsystem);

  try {
    return db
      .query<
        AppliedMigration,
        []
      >(`SELECT version, filename, applied_at, checksum FROM ${tableName} ORDER BY version`)
      .all();
  } catch {
    return [];
  }
}

/**
 * Runs all pending migrations for a subsystem.
 *
 * @param db - The database connection
 * @param subsystem - The subsystem to migrate
 * @returns Number of migrations applied
 */
export function runMigrations(db: Database, subsystem: MigrationSubsystem): number {
  // Ensure migration table exists
  ensureMigrationTable(db, subsystem);

  const currentVersion = getCurrentVersion(db, subsystem);
  const migrations = getMigrations(subsystem);
  const tableName = getMigrationTableName(subsystem);

  let applied = 0;

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    // Run migration in a transaction
    db.transaction(() => {
      // Execute the migration SQL
      db.run(migration.sql);

      // Record the migration
      const checksum = computeChecksum(migration.sql);
      db.run(`INSERT INTO ${tableName} (version, filename, checksum) VALUES (?, ?, ?)`, [
        migration.version,
        migration.filename,
        checksum,
      ]);
    })();

    applied++;
  }

  return applied;
}

/**
 * Runs migrations for all subsystems.
 * Use this when memory and history share the same database.
 *
 * @param db - The database connection
 * @returns Object with count of migrations applied per subsystem
 */
export function runAllMigrations(db: Database): Record<MigrationSubsystem, number> {
  return {
    memory: runMigrations(db, 'memory'),
    history: runMigrations(db, 'history'),
  };
}

// =============================================================================
// MIGRATION VALIDATION
// =============================================================================

/**
 * Validates that applied migrations haven't been modified.
 *
 * @param db - The database connection
 * @param subsystem - The subsystem to validate
 * @returns Array of migrations with checksum mismatches
 */
export function validateMigrations(
  db: Database,
  subsystem: MigrationSubsystem
): { migration: Migration; expectedChecksum: string; actualChecksum: string }[] {
  const applied = getAppliedMigrations(db, subsystem);
  const migrations = getMigrations(subsystem);
  const mismatches: { migration: Migration; expectedChecksum: string; actualChecksum: string }[] =
    [];

  for (const record of applied) {
    const migration = migrations.find((m) => m.version === record.version);
    if (!migration) {
      continue; // Migration file was removed, skip validation
    }

    const currentChecksum = computeChecksum(migration.sql);
    if (currentChecksum !== record.checksum) {
      mismatches.push({
        migration,
        expectedChecksum: record.checksum,
        actualChecksum: currentChecksum,
      });
    }
  }

  return mismatches;
}

/**
 * Gets pending migrations that haven't been applied yet.
 */
export function getPendingMigrations(db: Database, subsystem: MigrationSubsystem): Migration[] {
  const currentVersion = getCurrentVersion(db, subsystem);
  const migrations = getMigrations(subsystem);

  return migrations.filter((m) => m.version > currentVersion);
}
