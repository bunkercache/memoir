# Style Guide

This document defines the code standards and patterns for the Memoir project. All contributions should follow these guidelines.

## Table of Contents

1. [TypeScript Patterns](#typescript-patterns)
2. [Code Structure](#code-structure)
3. [Naming Conventions](#naming-conventions)
4. [Documentation](#documentation)
5. [Error Handling](#error-handling)
6. [Testing](#testing)
7. [Formatting](#formatting)

---

## TypeScript Patterns

### Early Returns (NeverNesters)

Always prefer early returns over deeply nested conditionals. Exit early to keep the happy path at the lowest indentation level.

```typescript
// Good: Early returns
function processUser(user: User | null): Result {
  if (!user) {
    return { error: 'User not found' };
  }

  if (!user.isActive) {
    return { error: 'User is inactive' };
  }

  // Happy path at base indentation
  return { data: user.profile };
}

// Bad: Deep nesting
function processUser(user: User | null): Result {
  if (user) {
    if (user.isActive) {
      return { data: user.profile };
    } else {
      return { error: 'User is inactive' };
    }
  } else {
    return { error: 'User not found' };
  }
}
```

### Avoid `else` After Return

When a branch returns, there's no need for `else`.

```typescript
// Good
function getValue(condition: boolean): string {
  if (condition) {
    return 'yes';
  }
  return 'no';
}

// Bad
function getValue(condition: boolean): string {
  if (condition) {
    return 'yes';
  } else {
    return 'no';
  }
}
```

### Use `const` by Default

Prefer `const` over `let`. Only use `let` when reassignment is necessary.

```typescript
// Good
const user = getUser();
const name = user.name;

// Acceptable when reassignment is needed
let count = 0;
for (const item of items) {
  count += item.value;
}

// For complex logic with multiple reassignments, consider IIFE
const result = (() => {
  let value = initialValue;
  // complex logic...
  return value;
})();
```

### Union Types for Status Strings

Use union types instead of enums for status-like values.

```typescript
// Good
type MemoryType = 'preference' | 'pattern' | 'decision' | 'context';
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

// Bad
enum MemoryType {
  Preference = 'preference',
  Pattern = 'pattern',
}
```

### Explicit Type Annotations

Prefer explicit type annotations for function parameters and class properties. Return types are optional but recommended for public APIs.

```typescript
// Good
function searchMemories(db: Database, query: string, options?: SearchOptions): SearchResult[] {
  // ...
}

// Good: Class with explicit types
class MemoryService {
  private readonly repository: MemoryRepository;
  private readonly config: ResolvedMemoirConfig;

  constructor(db: DatabaseLike, config: ResolvedMemoirConfig) {
    // ...
  }
}
```

### Nullish Coalescing and Optional Chaining

Use `??` for default values and `?.` for optional property access.

```typescript
// Good
const limit = options?.limit ?? this.config.memory.maxSearchResults;
const name = user?.profile?.name ?? 'Anonymous';

// Bad
const limit = options && options.limit ? options.limit : this.config.memory.maxSearchResults;
```

---

## Code Structure

### Module Organization

Each module should have a clear single responsibility. Use barrel exports (`index.ts`) for public APIs.

```
src/
  memory/
    index.ts       # Public API, re-exports, service
    repository.ts  # Data access layer
    search.ts      # Search-specific logic
    keywords.ts    # Keyword detection
    *.test.ts      # Tests alongside implementation
```

### Import Order

Group imports in this order, separated by blank lines:

1. Node.js built-ins (`node:fs`, `node:path`)
2. External packages (`@opencode-ai/plugin`, `sqlite-vec`)
3. Internal modules (relative imports)

```typescript
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import * as sqliteVec from 'sqlite-vec';
import { Database } from 'bun:sqlite';

import { runMigrations } from './migrations.ts';
import type { ResolvedMemoirConfig } from '../types.ts';
```

### File Extensions

Always use explicit `.ts` extensions for internal imports.

```typescript
// Good
import { MemoryRepository } from './repository.ts';

// Bad
import { MemoryRepository } from './repository';
```

### Singleton Pattern

Use the initialize/get/reset pattern for singletons.

```typescript
let instance: Service | null = null;

export function initializeService(config: Config): Service {
  if (!instance) {
    instance = new Service(config);
  }
  return instance;
}

export function getService(): Service {
  if (!instance) {
    throw new Error('Service not initialized. Call initializeService() first.');
  }
  return instance;
}

export function resetService(): void {
  instance = null;
}
```

---

## Naming Conventions

### General Rules

| Type            | Convention                    | Example                                   |
| --------------- | ----------------------------- | ----------------------------------------- |
| Classes         | PascalCase                    | `MemoryService`, `DatabaseService`        |
| Interfaces      | PascalCase                    | `SearchOptions`, `CreateMemoryInput`      |
| Type aliases    | PascalCase                    | `MemoryType`, `ResolvedConfig`            |
| Functions       | camelCase                     | `searchMemories`, `detectKeyword`         |
| Variables       | camelCase                     | `memoryService`, `searchResults`          |
| Constants       | camelCase or UPPER_SNAKE_CASE | `defaultConfig`, `MAX_RETRIES`            |
| Private members | camelCase (no prefix)         | `this.repository`, not `this._repository` |

### Descriptive Names

Names should be descriptive and self-documenting.

```typescript
// Good
const searchResults = searchMemories(db, query);
const isKeywordDetected = detectMemoryKeyword(text);
const memoryRepository = new MemoryRepository(db);

// Bad
const res = search(db, q);
const flag = detect(t);
const repo = new MemoryRepository(db);
```

### Boolean Names

Boolean variables and functions should read as yes/no questions.

```typescript
// Good
const isActive = user.status === 'active';
const hasPermission = checkPermission(user);
const canEdit = isOwner || isAdmin;

// Bad
const active = user.status === 'active';
const permission = checkPermission(user);
```

---

## Documentation

### JSDoc Comments

Use JSDoc for all exported functions, classes, and interfaces.

````typescript
/**
 * Searches memories using full-text search with BM25 ranking.
 *
 * Uses SQLite FTS5 to search memory content and tags.
 * Results are ranked by relevance using the BM25 algorithm.
 *
 * @param db - The database connection
 * @param query - The search query string
 * @param options - Optional search configuration
 * @returns Array of search results sorted by relevance
 *
 * @example
 * ```typescript
 * const results = searchMemories(db, 'typescript config');
 * for (const { memory, rank } of results) {
 *   console.log(`[${rank.toFixed(2)}] ${memory.content}`);
 * }
 * ```
 */
export function searchMemories(
  db: Database,
  query: string,
  options?: SearchOptions
): SearchResult[] {
  // ...
}
````

### Interface Documentation

Document each property of exported interfaces.

```typescript
/**
 * Options for memory search.
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  limit?: number;

  /** Filter results by memory type */
  type?: MemoryType;

  /** Minimum relevance score (0-1) */
  minScore?: number;
}
```

### Section Comments

Use section comments to organize large files.

```typescript
// =============================================================================
// DATABASE CREATION
// =============================================================================

export function createDatabase(dbPath: string): Database {
  // ...
}

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

let instance: DatabaseService | null = null;
```

---

## Error Handling

### Type-Safe Error Checking

Always check error types before accessing properties.

```typescript
// Good
try {
  await riskyOperation();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] Operation failed: ${message}`);
}

// Bad
try {
  await riskyOperation();
} catch (error) {
  console.error(`[ERROR] Operation failed: ${error.message}`);
}
```

### Throw Descriptive Errors

Include context in error messages.

```typescript
// Good
throw new Error(`Memory not found: ${id}`);
throw new Error('DatabaseService not initialized. Call initialize() first.');

// Bad
throw new Error('Not found');
throw new Error('Not initialized');
```

### Return null for "Not Found"

Use `null` for "not found" cases, throw for actual errors.

```typescript
// Good
function getById(id: string): Memory | null {
  const row = db.query('SELECT * FROM memories WHERE id = ?').get(id);
  if (!row) {
    return null; // Not found is a valid state
  }
  return mapRowToMemory(row);
}

// Then handle at call site
const memory = repository.getById(id);
if (!memory) {
  throw new Error(`Memory not found: ${id}`);
}
```

---

## Testing

### Test Organization

Use `describe` blocks for grouping and `it` blocks for individual tests.

```typescript
describe('MemoryRepository', () => {
  describe('create', () => {
    it('should create a memory with generated ID', () => {
      // ...
    });

    it('should store tags as JSON array', () => {
      // ...
    });
  });

  describe('getById', () => {
    it('should return null for non-existent ID', () => {
      // ...
    });
  });
});
```

### Test Naming

Test names should describe the expected behavior.

```typescript
// Good
it('should return null when memory does not exist', () => {});
it('should throw when database is not initialized', () => {});
it('should detect keywords outside of code blocks', () => {});

// Bad
it('test getById', () => {});
it('works correctly', () => {});
```

### Test Isolation

Each test should be independent. Use `beforeEach` for setup and `afterEach` for cleanup.

```typescript
describe('DatabaseService', () => {
  beforeEach(() => {
    DatabaseService.reset();
  });

  afterEach(() => {
    DatabaseService.reset();
  });

  it('should initialize with the given path', () => {
    const service = DatabaseService.initialize(':memory:');
    expect(service.getPath()).toBe(':memory:');
  });
});
```

---

## Formatting

Formatting is enforced by Prettier and ESLint. Run `mise run lint:fix` to auto-fix issues.

### Key Rules

- **Single quotes** for strings
- **Semicolons** required
- **2 spaces** for indentation
- **100 character** line width
- **Trailing commas** in arrays and objects (ES5 style)
- **No trailing commas** in function parameters

### ESLint Rules

- `no-console`: error (use proper logging)
- `@typescript-eslint/no-explicit-any`: warn (prefer specific types)
- `prettier/prettier`: error (formatting violations fail the build)

---

## Quick Reference

```typescript
// Imports: Node built-ins, external, internal
import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { MemoryRepository } from './repository.ts';

// Types: Union types, explicit annotations
type Status = 'pending' | 'complete';
function process(input: Input): Output { }

// Early returns, no else after return
function validate(user: User | null): boolean {
  if (!user) return false;
  if (!user.isActive) return false;
  return true;
}

// Const by default, descriptive names
const searchResults = searchMemories(db, query);
const isValid = validateInput(data);

// Error handling with type checking
catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
}

// JSDoc for exports
/**
 * Brief description.
 * @param x - Parameter description
 * @returns Return description
 */
export function example(x: string): number { }
```
