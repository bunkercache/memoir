/**
 * Storage Path Resolution Tests
 *
 * Tests for isLocalInstall and resolveStoragePaths functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { isLocalInstall, resolveStoragePaths } from './paths.ts';
import { DEFAULT_CONFIG } from './defaults.ts';
import type { ResolvedMemoirConfig } from '../types.ts';

describe('Storage Path Resolution', () => {
  let tempDir: string;
  let originalForceLocal: string | undefined;

  beforeEach(() => {
    // Save and clear MEMOIR_FORCE_LOCAL to ensure tests are isolated
    originalForceLocal = process.env.MEMOIR_FORCE_LOCAL;
    delete process.env.MEMOIR_FORCE_LOCAL;

    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'memoir-paths-test-'));
  });

  afterEach(() => {
    // Restore MEMOIR_FORCE_LOCAL
    if (originalForceLocal !== undefined) {
      process.env.MEMOIR_FORCE_LOCAL = originalForceLocal;
    } else {
      delete process.env.MEMOIR_FORCE_LOCAL;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isLocalInstall', () => {
    /**
     * Positive test: isLocalInstall should return true when .opencode/opencode.json exists.
     * Objective: Verify that the presence of .opencode/opencode.json indicates a local install.
     */
    it('should return true when .opencode/opencode.json exists', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: isLocalInstall should return true when opencode.json exists at root.
     * Objective: Verify that the presence of opencode.json at repo root indicates a local install.
     */
    it('should return true when opencode.json exists at root', () => {
      // Arrange
      writeFileSync(join(tempDir, 'opencode.json'), '{}');

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: isLocalInstall should prefer .opencode/opencode.json over root.
     * Objective: Verify that both config locations are checked.
     */
    it('should return true when both config files exist', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');
      writeFileSync(join(tempDir, 'opencode.json'), '{}');

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Negative test: isLocalInstall should return false when neither config exists.
     * Objective: Verify that absence of config files indicates a global install.
     */
    it('should return false when neither config file exists', () => {
      // Arrange - tempDir has no config files

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Negative test: isLocalInstall should return false when .opencode exists but no config.
     * Objective: Verify that just having the .opencode directory is not enough.
     */
    it('should return false when .opencode directory exists but no config file', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      // Create a different file, not opencode.json
      writeFileSync(join(opencodeDir, 'memoir.json'), '{}');

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Positive test: isLocalInstall should return true when .opencode/opencode.jsonc exists.
     * Objective: Verify that JSONC config files are also detected.
     */
    it('should return true when .opencode/opencode.jsonc exists', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.jsonc'), '{}');

      // Act
      const result = isLocalInstall(tempDir);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: isLocalInstall should return true when MEMOIR_FORCE_LOCAL is set.
     * Objective: Verify that the environment variable forces local detection.
     */
    it('should return true when MEMOIR_FORCE_LOCAL=1', () => {
      // Arrange - no config files, but env var is set
      const originalEnv = process.env.MEMOIR_FORCE_LOCAL;
      process.env.MEMOIR_FORCE_LOCAL = '1';

      try {
        // Act
        const result = isLocalInstall(tempDir);

        // Assert
        expect(result).toBe(true);
      } finally {
        // Cleanup
        if (originalEnv === undefined) {
          delete process.env.MEMOIR_FORCE_LOCAL;
        } else {
          process.env.MEMOIR_FORCE_LOCAL = originalEnv;
        }
      }
    });
  });

  describe('resolveStoragePaths', () => {
    const projectId = 'test-project-123';

    /**
     * Positive test: resolveStoragePaths should return local path for local installs.
     * Objective: Verify that local installs use .opencode/memoir/ for storage.
     */
    it('should return local path for local installs', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      // Act
      const result = resolveStoragePaths(tempDir, projectId, DEFAULT_CONFIG);

      // Assert
      expect(result.isLocal).toBe(true);
      expect(result.root).toBe(join(tempDir, '.opencode', 'memoir'));
      expect(result.memoryDb).not.toBeNull();
      expect(result.memoryDb!.path).toBe(join(tempDir, '.opencode', 'memoir', 'memory.db'));
      expect(result.sharedDatabase).toBe(true); // Default config uses shared database
    });

    /**
     * Positive test: resolveStoragePaths should return global path for global installs.
     * Objective: Verify that global installs use ~/.local/share/opencode/project/<id>/memoir/.
     * Note: This test uses the actual home directory.
     */
    it('should return global path for global installs', () => {
      // Arrange - no local config (tempDir has no opencode.json)
      const home = homedir();

      // Act
      const result = resolveStoragePaths(tempDir, projectId, DEFAULT_CONFIG);

      // Assert
      expect(result.isLocal).toBe(false);
      expect(result.root).toBe(
        join(home, '.local', 'share', 'opencode', 'project', projectId, 'memoir')
      );
      expect(result.memoryDb).not.toBeNull();
      expect(result.memoryDb!.path).toBe(
        join(home, '.local', 'share', 'opencode', 'project', projectId, 'memoir', 'memory.db')
      );

      // Cleanup - remove the created directory
      rmSync(result.root, { recursive: true, force: true });
    });

    /**
     * Positive test: resolveStoragePaths should respect directory: 'local' config option.
     * Objective: Verify that directory='local' forces local storage even for global installs.
     */
    it('should respect directory: local config option', () => {
      // Arrange - no local config (would normally be global), but directory is 'local'
      const configWithLocal: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          directory: 'local',
        },
      };

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithLocal);

      // Assert
      expect(result.isLocal).toBe(true);
      expect(result.root).toBe(join(tempDir, '.opencode', 'memoir'));
    });

    /**
     * Positive test: resolveStoragePaths should respect directory: 'global' config option.
     * Objective: Verify that directory='global' forces global storage even for local installs.
     */
    it('should respect directory: global config option', () => {
      // Arrange - create local config
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      const configWithGlobal: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          directory: 'global',
        },
      };
      const home = homedir();

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithGlobal);

      // Assert
      expect(result.isLocal).toBe(false);
      expect(result.root).toBe(
        join(home, '.local', 'share', 'opencode', 'project', projectId, 'memoir')
      );

      // Cleanup
      rmSync(result.root, { recursive: true, force: true });
    });

    /**
     * Positive test: resolveStoragePaths should create directory if it doesn't exist.
     * Objective: Verify that the storage directory is created automatically.
     */
    it('should create directory if it does not exist', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      const expectedDir = join(tempDir, '.opencode', 'memoir');
      expect(existsSync(expectedDir)).toBe(false);

      // Act
      const result = resolveStoragePaths(tempDir, projectId, DEFAULT_CONFIG);

      // Assert
      expect(existsSync(result.root)).toBe(true);
      expect(result.root).toBe(expectedDir);
    });

    /**
     * Positive test: resolveStoragePaths should use custom filename from config.
     * Objective: Verify that the database filename can be customized.
     */
    it('should use custom filename from config', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      const configWithCustomDb: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          filename: 'custom-memoir.db',
        },
      };

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithCustomDb);

      // Assert
      expect(result.memoryDb).not.toBeNull();
      expect(result.memoryDb!.path).toBe(join(tempDir, '.opencode', 'memoir', 'custom-memoir.db'));
    });

    /**
     * Positive test: resolveStoragePaths should support split databases.
     * Objective: Verify that separate memory and history databases can be configured.
     */
    it('should support split databases with separate filenames', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      const configWithSplitDb: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          filename: {
            memory: 'memories.db',
            history: 'history.db',
          },
        },
      };

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithSplitDb);

      // Assert
      expect(result.sharedDatabase).toBe(false);
      expect(result.memoryDb).not.toBeNull();
      expect(result.historyDb).not.toBeNull();
      expect(result.memoryDb!.path).toBe(join(tempDir, '.opencode', 'memoir', 'memories.db'));
      expect(result.historyDb!.path).toBe(join(tempDir, '.opencode', 'memoir', 'history.db'));
    });

    /**
     * Positive test: resolveStoragePaths should allow disabling features.
     * Objective: Verify that omitting a key in split config disables that feature.
     */
    it('should allow disabling history by omitting from filename config', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      const configWithMemoryOnly: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          filename: {
            memory: 'memories.db',
            // history omitted - feature disabled
          },
        },
      };

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithMemoryOnly);

      // Assert
      expect(result.memoryDb).not.toBeNull();
      expect(result.historyDb).toBeNull();
      expect(result.sharedDatabase).toBe(false);
    });

    /**
     * Positive test: resolveStoragePaths should not recreate existing directory.
     * Objective: Verify that existing directories are not affected.
     */
    it('should not fail if directory already exists', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      const memoirDir = join(opencodeDir, 'memoir');
      mkdirSync(memoirDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');
      // Create a marker file to verify directory wasn't recreated
      writeFileSync(join(memoirDir, 'marker.txt'), 'exists');

      // Act
      const result = resolveStoragePaths(tempDir, projectId, DEFAULT_CONFIG);

      // Assert
      expect(result.root).toBe(memoirDir);
      expect(existsSync(join(memoirDir, 'marker.txt'))).toBe(true);
    });

    /**
     * Positive test: resolveStoragePaths should handle different project IDs.
     * Objective: Verify that different projects get different storage paths.
     * Note: This test uses the actual home directory for global paths.
     */
    it('should use different paths for different project IDs', () => {
      // Arrange - no local config (global install)

      // Act
      const result1 = resolveStoragePaths(tempDir, 'project-a', DEFAULT_CONFIG);
      const result2 = resolveStoragePaths(tempDir, 'project-b', DEFAULT_CONFIG);

      // Assert
      expect(result1.root).not.toBe(result2.root);
      expect(result1.root).toContain('project-a');
      expect(result2.root).toContain('project-b');

      // Cleanup - remove the created directories
      rmSync(result1.root, { recursive: true, force: true });
      rmSync(result2.root, { recursive: true, force: true });
    });

    /**
     * Positive test: resolveStoragePaths should calculate gitignore paths for local databases.
     * Objective: Verify that gitignore paths are computed correctly.
     */
    it('should calculate gitignore paths for local databases', () => {
      // Arrange
      const opencodeDir = join(tempDir, '.opencode');
      mkdirSync(opencodeDir, { recursive: true });
      writeFileSync(join(opencodeDir, 'opencode.json'), '{}');

      // Act
      const result = resolveStoragePaths(tempDir, projectId, DEFAULT_CONFIG);

      // Assert
      expect(result.gitignorePaths.length).toBeGreaterThan(0);
      expect(result.gitignorePaths[0]).toBe('.opencode/memoir/memory.db');
    });

    /**
     * Positive test: resolveStoragePaths should support custom directory paths.
     * Objective: Verify that custom paths (not keywords) work correctly.
     */
    it('should support custom directory path', () => {
      // Arrange
      const customDir = join(tempDir, 'custom-storage');
      const configWithCustomDir: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        storage: {
          ...DEFAULT_CONFIG.storage,
          directory: customDir,
        },
      };

      // Act
      const result = resolveStoragePaths(tempDir, projectId, configWithCustomDir);

      // Assert
      expect(result.root).toBe(customDir);
      expect(result.memoryDb!.path).toBe(join(customDir, 'memory.db'));
    });
  });
});
