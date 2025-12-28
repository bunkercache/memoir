# AGENTS.md

## Build & Test Commands

- **Build**: `mise run build` or `bun build ./src/index.ts --outdir dist --target bun`
- **Test**: `mise run test` or `bun --bun run vitest run`
- **Single Test**: `bun --bun run vitest run src/tools/memoir.test.ts`
- **Watch Mode**: `bun --bun run vitest --watch`
- **Lint**: `mise run lint` (eslint)
- **Fix Lint**: `mise run lint:fix` (eslint --fix)
- **Format**: `mise run format` (prettier)

## Local Plugin Testing

To test the Memoir plugin locally within this project:

1. Build the plugin: `mise run build`
2. Create the plugin loader (if not exists):
   ```bash
   mkdir -p .opencode/plugin
   ```
3. Create `.opencode/plugin/memoir.ts`:
   ```typescript
   import { MemoirPlugin } from '../../dist/index.js';
   export { MemoirPlugin };
   ```
4. OpenCode will automatically load the plugin from `.opencode/plugin/`

The `.opencode/plugin/` directory is gitignored for local development only.

### Plugin Loader Features

The local plugin loader (`.opencode/plugin/memoir.ts`) includes:

- **Auto-build**: If `dist/index.js` doesn't exist, it will attempt to build automatically
- **Disable via env var**: Set `BUNKERCACHE_MEMOIR_DISABLED=1` to disable the plugin
- **Stub fallback**: If the build fails, a no-op stub plugin is used

### Environment Variables

- `BUNKERCACHE_MEMOIR_DISABLED=1` - Disable the local Memoir plugin (used in CI workflows)
- `MEMOIR_FORCE_LOCAL=1` - Force Memoir to use local storage (auto-set by local plugin loader)

## Code Style Guidelines

### Imports & Module System

- Use ES6 `import`/`export` syntax (module: "ESNext", type: "module")
- Group imports: external libraries first, then internal modules
- Use explicit file extensions (`.ts`) for internal imports

### Formatting (Prettier)

- **Single quotes** (`singleQuote: true`)
- **Line width**: 100 characters
- **Tab width**: 2 spaces
- **Trailing commas**: ES5 (no trailing commas in function parameters)
- **Semicolons**: enabled

### TypeScript & Naming

- **NeverNesters**: avoid deeply nested structures. Always exit early.
- **Strict mode**: enforced (`"strict": true`)
- **Classes**: PascalCase (e.g., `BackgroundTask`, `BackgroundTaskManager`)
- **Methods/properties**: camelCase
- **Status strings**: use union types (e.g., `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`)
- **Explicit types**: prefer explicit type annotations over inference
- **Return types**: optional (not required but recommended for public methods)

### Error Handling

- Check error type before accessing error properties: `error instanceof Error ? error.toString() : String(error)`
- Log errors with `[ERROR]` prefix for consistency
- Always provide error context when recording output

### Linting Rules

- `@typescript-eslint/no-explicit-any`: warn (avoid `any` type)
- `no-console`: error (minimize console logs)
- `prettier/prettier`: error (formatting violations are errors)

## Testing

- Framework: **vitest** with `describe` & `it` blocks
- Style: Descriptive nested test cases with clear expectations
- Assertion library: `expect()` (vitest)

## Project Context

- **Type**: ES Module package for OpenCode plugin system
- **Target**: Bun runtime, ES2021+
- **Purpose**: Local-first, repo-scoped memory plugin with hierarchical session history

## Architecture

Memoir provides two interrelated systems:

1. **Project Memory** - Persistent learnings about the codebase (preferences, patterns, gotchas)
2. **Session History** - Hierarchical chunk tree for traversing compacted conversation history

Key technologies:

- **SQLite** with Bun's built-in driver
- **sqlite-vec** for vector search (future)
- **FTS5** for full-text search with BM25 ranking

## GitHub Workflows

- `pr.yml` - CI for pull requests (lint, test, build)
- `opencode.yml` - `/oc` and `/opencode` commands in issues/PRs
- `review.yml` - `/review` command for code review against STYLEGUIDE.md
- `stale-issues.yml` - Auto-close stale issues
- `release.yml` / `release-next.yml` - Release automation with release-please
- `publish.yml` - Publish to npm on release

## Reusable Actions

- `.github/actions/setup-bun` - Bun setup with dependency caching
- `.github/actions/checkout-v6-compat` - Migrate v6 checkout credentials to local git config
