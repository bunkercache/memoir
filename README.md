# @bunkercache/opencode-memoir

A local-first, repo-scoped memory plugin for OpenCode. Provides persistent project learnings and hierarchical session history with "blockchain-style" compaction.

## Features

- **Project Memory** - Store preferences, patterns, gotchas, and facts about your codebase
- **Session History** - Hierarchical chunk tree for traversing compacted conversation history
- **Full-Text Search** - SQLite FTS5 with BM25 ranking
- **Keyword Detection** - Auto-save when you say "remember", "don't forget", etc.
- **Vector Search Ready** - Schema supports sqlite-vec for future semantic search

## Installation

```bash
bun add @bunkercache/opencode-memoir
```

Add to your OpenCode config (`~/.config/opencode/config.json`):

```json
{
  "plugins": ["@bunkercache/opencode-memoir"]
}
```

## Tools

The plugin provides three tools for the LLM:

### `memoir`

Add, search, list, or forget project memories.

```
memoir add "Always run tests before committing" --type preference
memoir search "testing patterns"
memoir list --limit 10
memoir forget mem_abc123
```

### `memoir_expand`

Expand a compacted chunk to see full details.

```
memoir_expand ch_abc123
memoir_expand ch_abc123 --include-children
```

### `memoir_history`

Search session history chunks.

```
memoir_history "auth bug fix"
memoir_history "rate limiting" --session abc123
```

## Memory Types

| Type         | Description                         | Example                                  |
| ------------ | ----------------------------------- | ---------------------------------------- |
| `preference` | User/project preferences            | "Always run tests after changes"         |
| `pattern`    | Coding patterns used in the project | "We use Result<T, E> for error handling" |
| `gotcha`     | Known issues or things to avoid     | "Don't use lodash, we have utilities"    |
| `fact`       | General facts about the project     | "API is at /api/v2"                      |
| `learned`    | Auto-detected patterns              | "User prefers TypeScript strict mode"    |

## Configuration

Create `~/.config/opencode/memoir.json` (global) or `<repo>/.opencode/memoir.json` (local):

```json
{
  "$schema": "https://bunkercache.github.io/opencode-memoir/schema/config.json",
  "memory": {
    "maxInject": 10,
    "maxSearchResults": 20,
    "keywordDetection": true,
    "customKeywords": ["note to self"]
  },
  "storage": {
    "forceLocal": true
  }
}
```

See [schema/config.schema.json](schema/config.schema.json) for all options.

## How It Works

### Context Injection

On the first message of each session, Memoir searches for relevant memories and injects them into the context.

### Keyword Detection

When you say things like "remember this" or "don't forget", Memoir nudges the LLM to save the information.

### Chunk Compaction

When OpenCode compacts a session, Memoir creates summary chunks that reference the original chunks. Use `memoir_expand` to drill down into details.

```
Session: abc123
┌─────────────────────────────────────────────────────────────┐
│ Summary Chunk (ch_003)                                       │
│ "Fixed auth bug [ch_001], added rate limiting [ch_002]"      │
│     │                                                        │
│     ├── ch_001: Full auth fix details                        │
│     └── ch_002: Full rate limiting details                   │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
bun install

# Run tests
mise run test

# Build
mise run build

# Lint
mise run lint
mise run lint:fix

# Format
mise run format
```

## Storage Locations

**Local install** (when `.opencode/opencode.json` exists):

```
<repo>/.opencode/memoir/memory.db
```

**Global install**:

```
~/.local/share/opencode/project/<project-id>/memoir/memory.db
```

## Contributing

Contributions welcome! Please read [STYLEGUIDE.md](STYLEGUIDE.md) before submitting PRs.

## License

MIT License. See [LICENSE](LICENSE) for details.
