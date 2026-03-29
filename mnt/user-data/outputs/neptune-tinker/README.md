# neptune-tinker

Neptune-compatible local sandbox using TinkerGraph. **Claude-first** dev tooling.

## What This Is

Amazon Neptune implements a **subset** of Apache TinkerPop Gremlin, plus **multi-label vertices** (the `::` syntax). This makes local development tricky — code that works on TinkerGraph might fail on Neptune, and multi-labels don't exist in TinkerGraph natively.

`neptune-tinker` solves this with:

1. **Docker sandbox** — TinkerGraph Gremlin Server, one command to start
2. **Multi-label middleware** — emulates Neptune's `::` multi-label semantics on TinkerGraph (two strategies: delimiter-based or property-based)
3. **Compatibility guard** — lints Gremlin queries against Neptune's constraints, catches incompatible patterns before they reach production
4. **Claude skills** — documentation and review procedures that make Claude aware of Neptune's quirks, so generated code stays compatible

## Quick Start

```bash
# Start the sandbox (default port 8182)
npm run sandbox:start

# Or on a custom port
NEPTUNE_TINKER_PORT=9182 npm run sandbox:start

# Tail logs
npm run sandbox:logs

# Reset (clears all in-memory data)
npm run sandbox:reset

# Stop
npm run sandbox:stop
```

```typescript
import { NeptuneSandbox } from 'neptune-tinker';

const sandbox = new NeptuneSandbox({
  port: 9182,                        // must match the script port
  multiLabelStrategy: 'delimiter',   // or 'property'
  guardMode: 'strict',               // or 'loose'
});

await sandbox.connect();

// Create a multi-label vertex (Neptune-style)
await sandbox.addV('Person::Employee', { name: 'Alice', age: 30 }, 'alice-1');

// Query by single label component
const people = await sandbox.V_byLabel('Person').toList();

// Lint a raw query
const issues = sandbox.lint(`g.V(123).hasLabel('A::B')`);
// → [{ rule: 'string-ids-only', ... }, { rule: 'no-hasLabel-with-delimiter', ... }]

await sandbox.close();
```

## Claude Integration

### Skills (for Claude Code / custom skills)

Copy the `skills/` directory into your Claude skill path:

- **`NEPTUNE_COMPAT.md`** — Reference for all Neptune constraints. Claude reads this before writing any Gremlin.
- **`REVIEW_QUERY.md`** — Step-by-step procedure for Claude to review a Gremlin query for Neptune compatibility.

### MCP Tool Usage (planned)

The sandbox exposes Gremlin Server on the configured port. A Claude Code MCP tool can connect directly to execute and test queries against the sandbox.

## Configuration

### TypeScript API

| Option | Default | Description |
|--------|---------|-------------|
| `host` | `"localhost"` | Gremlin Server host |
| `port` | `8182` | Gremlin Server port |
| `endpoint` | derived from host/port | Full WebSocket URL (overrides host/port) |
| `multiLabelStrategy` | `"delimiter"` | `"delimiter"` stores `A::B::C` as the native label; `"property"` uses a hidden `__labels` property |
| `guardMode` | `"strict"` | `"strict"` throws on violations; `"loose"` warns only |

### Docker Compose (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEPTUNE_TINKER_PORT` | `8182` | Host port to expose |
| `NEPTUNE_TINKER_CONTAINER` | `neptune-tinker` | Docker container name |
| `NEPTUNE_TINKER_IMAGE` | `tinkerpop/gremlin-server:3.7.2` | Docker image |

Set via env vars inline, in a `.env` file alongside `scripts/docker-compose.yml`, or in your shell profile. See `scripts/.env.example`.

## Neptune vs TinkerGraph — Key Differences

| Area | Neptune | TinkerGraph |
|------|---------|-------------|
| Multi-labels | ✅ `addV('A::B')` | ❌ Not supported (we emulate) |
| Default cardinality | `set` | `list` |
| ID types | String only | Any |
| Lambdas | ❌ | ✅ |
| Groovy code | ❌ | ✅ |
| `graph` object | ❌ | ✅ |
| `list` cardinality | ❌ | ✅ |
| MetaProperties | ❌ | ✅ |
| Variables | ❌ | ✅ |

## Architecture

```
┌─────────────────────────────────────────┐
│  Your App / Claude Code                 │
│                                         │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ NeptuneSandbox│  │  Guard / Lint  │   │
│  │  .addV()     │  │  .lint(query)  │   │
│  │  .V_byLabel()│  │  .guard(query) │   │
│  └──────┬───────┘  └────────────────┘   │
│         │                               │
│  ┌──────▼───────┐                       │
│  │ Multi-label  │                       │
│  │ Middleware    │                       │
│  └──────┬───────┘                       │
│         │  gremlin-javascript           │
└─────────┼───────────────────────────────┘
          │ WebSocket
┌─────────▼───────────────────────────────┐
│  Docker: Gremlin Server + TinkerGraph   │
└─────────────────────────────────────────┘
```

## License

MIT
