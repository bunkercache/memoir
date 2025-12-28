/**
 * Config Module Tests
 *
 * Tests for configuration resolution and the ConfigService singleton.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { resolveConfig, mergeConfig, ConfigService, DEFAULT_CONFIG } from './index.ts';
import type { MemoirConfig } from '../types.ts';

describe('Config Module', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'memoir-config-test-'));
    // Reset ConfigService singleton between tests
    ConfigService.reset();
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
    // Ensure singleton is reset
    ConfigService.reset();
  });

  describe('mergeConfig', () => {
    /**
     * Positive test: mergeConfig should deep merge partial configs with defaults.
     * Objective: Verify that user-provided partial configs are correctly merged
     * with default values, preserving defaults for unspecified fields.
     */
    it('should deep merge partial configs with defaults', () => {
      // Arrange
      const override: MemoirConfig = {
        memory: { maxInject: 5 },
        storage: { directory: 'local' },
      };

      // Act
      const result = mergeConfig(DEFAULT_CONFIG, override);

      // Assert
      expect(result.memory.maxInject).toBe(5);
      expect(result.memory.maxSearchResults).toBe(DEFAULT_CONFIG.memory.maxSearchResults);
      expect(result.memory.keywordDetection).toBe(DEFAULT_CONFIG.memory.keywordDetection);
      expect(result.storage.directory).toBe('local');
      expect(result.storage.filename).toBe(DEFAULT_CONFIG.storage.filename);
      expect(result.chunks).toEqual(DEFAULT_CONFIG.chunks);
      expect(result.search).toEqual(DEFAULT_CONFIG.search);
      expect(result.logging).toEqual(DEFAULT_CONFIG.logging);
    });

    /**
     * Positive test: mergeConfig should handle empty override.
     * Objective: Verify that an empty override returns the base config unchanged.
     */
    it('should handle empty override', () => {
      // Arrange
      const override: MemoirConfig = {};

      // Act
      const result = mergeConfig(DEFAULT_CONFIG, override);

      // Assert
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    /**
     * Positive test: mergeConfig should override all sections when provided.
     * Objective: Verify that all config sections can be overridden.
     */
    it('should override all sections when provided', () => {
      // Arrange
      const override: MemoirConfig = {
        memory: {
          maxInject: 20,
          maxSearchResults: 50,
          keywordDetection: false,
          customKeywords: ['remember', 'note'],
        },
        chunks: {
          maxContentSize: 100000,
          maxCompactionContext: 20,
          autoArchiveDays: 30,
        },
        search: {
          mode: 'vector',
          embedding: {
            provider: 'openai',
            model: 'text-embedding-3-small',
          },
        },
        storage: {
          directory: 'local',
          filename: 'custom.db',
          gitignore: false, // Include all fields to test complete override
        },
        logging: {
          debug: true,
          file: 'memoir.log',
        },
      };

      // Act
      const result = mergeConfig(DEFAULT_CONFIG, override);

      // Assert
      expect(result.memory).toEqual(override.memory);
      expect(result.chunks).toEqual(override.chunks);
      expect(result.search).toEqual(override.search);
      expect(result.storage).toEqual(override.storage);
      expect(result.logging).toEqual(override.logging);
    });
  });

  describe('resolveConfig', () => {
    /**
     * Positive test: resolveConfig should return default config when no config files exist.
     * Objective: Verify that the default configuration is returned when neither
     * local nor global config files are present.
     */
    it('should return default config when no config files exist', () => {
      // Arrange - tempDir has no config files

      // Act
      const result = resolveConfig(tempDir);

      // Assert
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.source).toBe('default');
      expect(result.path).toBeUndefined();
    });

    /**
     * Positive test: resolveConfig should load local config from .opencode/memoir.json.
     * Objective: Verify that local config is loaded and merged with defaults.
     */
    it('should load local config from .opencode/memoir.json', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      const localConfig: MemoirConfig = {
        memory: { maxInject: 15 },
        logging: { debug: true },
      };
      writeFileSync(join(localConfigDir, 'memoir.json'), JSON.stringify(localConfig));

      // Act
      const result = resolveConfig(tempDir);

      // Assert
      expect(result.source).toBe('local');
      expect(result.path).toBe(join(localConfigDir, 'memoir.json'));
      expect(result.config.memory.maxInject).toBe(15);
      expect(result.config.logging.debug).toBe(true);
      // Defaults should still be applied for unspecified values
      expect(result.config.memory.maxSearchResults).toBe(DEFAULT_CONFIG.memory.maxSearchResults);
    });

    /**
     * Positive test: resolveConfig should load global config from ~/.config/opencode/memoir.json.
     * Objective: Verify that global config is loaded when no local config exists.
     * Note: This test uses the actual home directory's global config path.
     */
    it('should load global config from ~/.config/opencode/memoir.json', () => {
      // Arrange - Create global config in actual home directory
      const globalConfigDir = join(homedir(), '.config', 'opencode');
      const globalConfigPath = join(globalConfigDir, 'memoir.json');
      const globalConfigExists = existsSync(globalConfigPath);

      // Skip if global config already exists (don't modify user's config)
      if (globalConfigExists) {
        // Just verify the function doesn't crash with existing config
        const result = resolveConfig(tempDir);
        expect(['local', 'global', 'default']).toContain(result.source);
        return;
      }

      // Create temporary global config
      mkdirSync(globalConfigDir, { recursive: true });
      const globalConfig: MemoirConfig = {
        storage: { directory: 'local' },
        chunks: { autoArchiveDays: 7 },
      };
      writeFileSync(globalConfigPath, JSON.stringify(globalConfig));

      try {
        // Act
        const result = resolveConfig(tempDir);

        // Assert
        expect(result.source).toBe('global');
        expect(result.path).toBe(globalConfigPath);
        expect(result.config.storage.directory).toBe('local');
        expect(result.config.chunks.autoArchiveDays).toBe(7);
      } finally {
        // Cleanup - remove the test global config
        rmSync(globalConfigPath, { force: true });
      }
    });

    /**
     * Positive test: Local config should take precedence over global config.
     * Objective: Verify that when both local and global configs exist,
     * local config is used (higher precedence).
     */
    it('should prefer local config over global config', () => {
      // Arrange - Create local config (global config may or may not exist)
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      const localConfig: MemoirConfig = {
        memory: { maxInject: 25 },
      };
      writeFileSync(join(localConfigDir, 'memoir.json'), JSON.stringify(localConfig));

      // Act
      const result = resolveConfig(tempDir);

      // Assert - Local should always win
      expect(result.source).toBe('local');
      expect(result.config.memory.maxInject).toBe(25);
    });

    /**
     * Negative test: resolveConfig should throw on malformed JSON.
     * Objective: Verify that invalid JSON in config file causes an error.
     */
    it('should throw on malformed JSON in config file', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(join(localConfigDir, 'memoir.json'), '{ invalid json }');

      // Act & Assert
      expect(() => resolveConfig(tempDir)).toThrow();
    });

    /**
     * Positive test: resolveConfig should handle $schema field in config.
     * Objective: Verify that the $schema field is ignored during merge.
     */
    it('should handle $schema field in config', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      const localConfig: MemoirConfig = {
        $schema: '../schema/config.schema.json',
        memory: { maxInject: 8 },
      };
      writeFileSync(join(localConfigDir, 'memoir.json'), JSON.stringify(localConfig));

      // Act
      const result = resolveConfig(tempDir);

      // Assert
      expect(result.config.memory.maxInject).toBe(8);
      // $schema should not affect the resolved config
      expect((result.config as unknown as MemoirConfig).$schema).toBeUndefined();
    });
  });

  describe('ConfigService', () => {
    /**
     * Positive test: ConfigService.initialize should create singleton and return same instance.
     * Objective: Verify that initialize creates a singleton that persists across calls.
     */
    it('should initialize and return same instance on subsequent calls', () => {
      // Arrange & Act
      const instance1 = ConfigService.initialize(tempDir);
      const instance2 = ConfigService.initialize(tempDir);

      // Assert
      expect(instance1).toBe(instance2);
    });

    /**
     * Positive test: ConfigService.get should return initialized instance.
     * Objective: Verify that get() returns the singleton after initialization.
     */
    it('should return initialized instance via get()', () => {
      // Arrange
      const initialized = ConfigService.initialize(tempDir);

      // Act
      const retrieved = ConfigService.get();

      // Assert
      expect(retrieved).toBe(initialized);
    });

    /**
     * Negative test: ConfigService.get should throw if not initialized.
     * Objective: Verify that accessing the service before initialization throws an error.
     */
    it('should throw if get() called before initialize()', () => {
      // Arrange - ConfigService is reset in beforeEach

      // Act & Assert
      expect(() => ConfigService.get()).toThrow(
        'ConfigService not initialized. Call ConfigService.initialize() first.'
      );
    });

    /**
     * Positive test: ConfigService.reset should clear the singleton instance.
     * Objective: Verify that reset() clears the singleton, allowing re-initialization.
     */
    it('should clear instance on reset()', () => {
      // Arrange
      ConfigService.initialize(tempDir);

      // Act
      ConfigService.reset();

      // Assert
      expect(() => ConfigService.get()).toThrow();
    });

    /**
     * Positive test: ConfigService should provide access to all config sections.
     * Objective: Verify that all config section getters work correctly.
     */
    it('should provide access to all config sections', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      const localConfig: MemoirConfig = {
        memory: { maxInject: 12 },
        chunks: { maxContentSize: 75000 },
        search: { mode: 'vector' },
        storage: { directory: 'local' },
        logging: { debug: true },
      };
      writeFileSync(join(localConfigDir, 'memoir.json'), JSON.stringify(localConfig));

      // Act
      const service = ConfigService.initialize(tempDir);

      // Assert
      expect(service.memory.maxInject).toBe(12);
      expect(service.chunks.maxContentSize).toBe(75000);
      expect(service.search.mode).toBe('vector');
      expect(service.storage.directory).toBe('local');
      expect(service.logging.debug).toBe(true);
    });

    /**
     * Positive test: ConfigService.getSource should return correct source.
     * Objective: Verify that getSource() returns the config source.
     */
    it('should return correct source via getSource()', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      writeFileSync(join(localConfigDir, 'memoir.json'), JSON.stringify({}));

      // Act
      const service = ConfigService.initialize(tempDir);

      // Assert
      expect(service.getSource()).toBe('local');
    });

    /**
     * Positive test: ConfigService.getPath should return config file path.
     * Objective: Verify that getPath() returns the path when config file exists.
     */
    it('should return config path via getPath()', () => {
      // Arrange
      const localConfigDir = join(tempDir, '.opencode');
      mkdirSync(localConfigDir, { recursive: true });
      const configPath = join(localConfigDir, 'memoir.json');
      writeFileSync(configPath, JSON.stringify({}));

      // Act
      const service = ConfigService.initialize(tempDir);

      // Assert
      expect(service.getPath()).toBe(configPath);
    });

    /**
     * Positive test: ConfigService.getPath should return undefined for defaults.
     * Objective: Verify that getPath() returns undefined when using default config.
     */
    it('should return undefined path when using defaults', () => {
      // Arrange - no config files

      // Act
      const service = ConfigService.initialize(tempDir);

      // Assert
      expect(service.getSource()).toBe('default');
      expect(service.getPath()).toBeUndefined();
    });
  });
});
