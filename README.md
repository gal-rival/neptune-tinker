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
# Install
pnpm install

# Build TypeScript
pnpm run build

# Start the sandbox (default port 8182)
pnpm run sandbox:start

# Tail logs
pnpm run sandbox:logs

# Reset (clears all in-memory data)
pnpm run sandbox:reset

# Stop
pnpm run sandbox:stop
```

### Interactive REPL (recommended)

The REPL drops you into a Node.js session with the middleware pre-loaded and connected:

```bash
pnpm run sandbox:repl
```

```
neptune> await sandbox.addV("Person::Employee", { name: "Alice" }, "a1")
neptune> await sandbox.addV("Person::Manager", { name: "Bob" }, "b1")
neptune> await sandbox.V_byLabel("Person").toList()    // matches both
neptune> await g.V().count().next()                     // raw Gremlin via g
neptune> lint("g.V(123)")                               // lint a query string
neptune> guard("g.V(123)")                              // throws NeptuneCompatError
```

Available globals:
- `sandbox` — connected `NeptuneSandbox` instance
- `g` — Gremlin traversal source (for raw bytecode queries)
- `lint(query)` — check a Gremlin string for Neptune violations
- `guard(query)` — same, but throws in strict mode

### Gremlin Console

For raw Gremlin (Groovy syntax, no middleware):

```bash
pnpm run sandbox:console
```

Auto-connects to the server — start querying immediately:

```groovy
g.addV('Person').property('name', 'Alice').property(id, 'a1')
g.V().valueMap(true)
```

## Integrating Into Another Repo

### Install

```bash
pnpm add neptune-tinker
```

### CLI (from package.json scripts)

```jsonc
// consumer's package.json
{
  "scripts": {
    "sandbox:start": "neptune-tinker start",
    "sandbox:stop": "neptune-tinker stop",
    "sandbox:repl": "neptune-tinker repl",
    "sandbox:console": "neptune-tinker console"
  }
}
```

All paths resolve automatically — no config needed.

### Programmatic (in test setup, scripts, etc.)

```typescript
import { startSandbox, stopSandbox, NeptuneSandbox } from 'neptune-tinker';

// Start Docker sandbox (blocks until healthy)
startSandbox();

// Use the middleware
const sandbox = new NeptuneSandbox();
await sandbox.connect();

await sandbox.addV('Person::Employee', { name: 'Alice', age: 30 }, 'alice-1');
const people = await sandbox.V_byLabel('Person').toList();

const issues = sandbox.lint(`g.V(123).hasLabel('A::B')`);
// → [{ rule: 'string-ids-only', ... }, { rule: 'no-hasLabel-with-delimiter', ... }]

await sandbox.close();

// Stop when done
stopSandbox();
```

### Custom port

```typescript
startSandbox({ port: 9182 });
const sandbox = new NeptuneSandbox({ port: 9182 });
```

Or via CLI: `neptune-tinker start --port 9182`

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

Set via env vars inline (e.g. `NEPTUNE_TINKER_PORT=9182 pnpm run sandbox:start`), in a `.env` file alongside `scripts/docker-compose.yml`, or in your shell profile.

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

## Known Limitations

### What the transparent `g` wrapper handles

The traversal source returned by `sandbox.connect()` intercepts these steps to apply Neptune semantics:

| Step | Behavior |
|------|----------|
| `g.addV("A::B")` | Multi-label emulation (property strategy adds `__labels`) |
| `g.V().hasLabel("A")` | Multi-label matching (matches `"A::B::C"` vertices) |
| `g.V().has("A", "key", "val")` | Routes through multi-label `hasLabel` |
| `g.V().has(t.label, "A")` | Routes through multi-label `hasLabel` |
| `g.V().property("k", "v")` | Defaults to `set` cardinality (also enforced server-side) |

### What it does NOT handle

- **Anonymous traversals** — Use `sandbox.__` (or `const __ = sandbox.__`) instead of `gprocess.statics` for multi-label-aware anonymous traversals inside `where()`, `filter()`, `not()`.
- **Auto-generated IDs** — `sandbox.addV()` auto-generates UUID string IDs (matching Neptune). Raw `g.addV()` uses TinkerGraph's numeric IDs — always chain `.property(t.id, "my-id")` when using raw `g`.
- **Guard on bytecode** — The `lint()`/`guard()` functions only check string queries. Bytecode queries (the normal `g.V()...` API) are handled by the traversal overrides instead.
- **`__labels` visibility** — With the `"property"` multi-label strategy, the internal `__labels` property is visible in `valueMap()` results. Use the default `"delimiter"` strategy to avoid this.

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
