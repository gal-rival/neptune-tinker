# neptune-tinker

Neptune-compatible local sandbox using TinkerGraph. **Claude-first** dev tooling.

## What This Is

Amazon Neptune implements a **subset** of Apache TinkerPop Gremlin, plus **multi-label vertices** (the `::` syntax). This makes local development tricky — code that works on TinkerGraph might fail on Neptune, and multi-labels don't exist in TinkerGraph natively.

`neptune-tinker` solves this with:

1. **Docker sandbox** — TinkerGraph Gremlin Server with Neptune semantics applied **server-side**, one command to start
2. **Server-side Neptune strategy** — a Groovy `TraversalStrategy` that emulates multi-label matching, UUID auto-generation, and set cardinality inside the Gremlin Server itself — works for **all clients** (Python, Java, JS, Gremlin Console)
3. **Compatibility guard** — lints Gremlin queries against Neptune's constraints, catches incompatible patterns before they reach production
4. **Claude skills** — documentation and review procedures that make Claude aware of Neptune's quirks

## Quick Start

```bash
# Install
pnpm install

# Build TypeScript
pnpm run build

# Start the sandbox (default port 8182)
pnpm run sandbox:start

# Check health
pnpm run sandbox:health

# Run a one-off query
pnpm run sandbox:run 'g.V().count()'

# Tail logs
pnpm run sandbox:logs

# Reset (clears all data)
pnpm run sandbox:reset

# Stop
pnpm run sandbox:stop
```

### Interactive REPL

The REPL drops you into a Node.js session connected to the sandbox:

```bash
pnpm run sandbox:repl
```

```
neptune> await g.addV("Person::Employee").property(t.id, "a1").property("name", "Alice").next()
neptune> await g.addV("Person::Manager").property(t.id, "b1").property("name", "Bob").next()
neptune> await g.V().hasLabel("Person").toList()         // matches both
neptune> await g.V().count().next()
neptune> lint("g.V(123)")                                // lint a query string
neptune> guard("g.V(123)")                               // throws NeptuneCompatError
```

Available globals:
- `sandbox` — connected `NeptuneSandbox` instance
- `g` — Gremlin traversal source
- `t`, `P`, `TextP`, `order`, `scope`, `column`, `direction`, `cardinality` — Gremlin enums
- `lint(query)` — check a Gremlin string for Neptune violations
- `guard(query)` — same, but throws in strict mode

### Gremlin Console

For raw Gremlin (Groovy syntax):

```bash
pnpm run sandbox:console
```

Auto-connects to the server — start querying immediately:

```groovy
g.addV('Person::Employee').property(id, 'a1').property('name', 'Alice')
g.V().hasLabel('Person').valueMap(true)
```

## CLI

```bash
neptune-tinker start [--port N] [--name NAME] [--no-persist]
neptune-tinker stop [--name NAME]
neptune-tinker reset [--name NAME]
neptune-tinker health [--name NAME]
neptune-tinker logs [--name NAME]
neptune-tinker console [--name NAME]
neptune-tinker repl [--port N]
neptune-tinker run '<gremlin query>' [--port N]
neptune-tinker import <file.json> [--port N]
```

`--name` creates an isolated sandbox instance with an auto-assigned port (useful for running multiple sandboxes).

`--no-persist` disables data persistence across container restarts.

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
    "sandbox:console": "neptune-tinker console",
    "sandbox:run": "neptune-tinker run"
  }
}
```

All paths resolve automatically — no config needed.

### Programmatic (in test setup, scripts, etc.)

```typescript
import { startSandbox, stopSandbox, NeptuneSandbox } from 'neptune-tinker';
import gremlin from 'gremlin';

const { process: gprocess } = gremlin;
const { t } = gprocess;

// Start Docker sandbox (blocks until healthy)
startSandbox();

// Connect — returns a standard Gremlin traversal source
// All Neptune semantics are handled server-side, no special API needed
const sandbox = new NeptuneSandbox();
await sandbox.connect();
const g = sandbox.g;

// Use standard Gremlin — multi-labels, set cardinality, and UUID
// auto-generation all work transparently via the server-side strategy
await g.addV('Person::Employee').property(t.id, 'alice-1').property('name', 'Alice').next();
await g.addV('Person::Manager').property(t.id, 'bob-1').property('name', 'Bob').next();

const people = await g.V().hasLabel('Person').toList(); // matches both
const managers = await g.V().hasLabel('Manager').toList(); // matches bob only

// Lint a query string for Neptune compatibility
const issues = sandbox.lint(`g.V(123).hasLabel('A::B')`);
// → [{ rule: 'string-ids-only', ... }, { rule: 'no-hasLabel-with-delimiter', ... }]

// Submit a raw Gremlin string (guarded)
const result = await sandbox.submit(`g.V('alice-1').valueMap()`);

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

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Your App / Test / AI Agent                     │
│                                                 │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ NeptuneSandbox│  │  Guard / Lint          │   │
│  │  .connect()  │  │  .lint(query)          │   │
│  │  .submit()   │  │  .guard(query)         │   │
│  └──────┬───────┘  └────────────────────────┘   │
│         │  Standard gremlin-javascript           │
│         │  (no middleware, no magic)              │
└─────────┼───────────────────────────────────────┘
          │ WebSocket
┌─────────▼───────────────────────────────────────┐
│  Docker: Gremlin Server 3.7.2 + TinkerGraph    │
│                                                 │
│  NeptuneMultiLabelStrategy (server-side Groovy) │
│  ├── Multi-label hasLabel() rewriting           │
│  ├── UUID auto-generation for addV()            │
│  └── Set cardinality (tinkergraph.properties)   │
│                                                 │
│  Works for ALL clients: JS, Python, Java, etc.  │
└─────────────────────────────────────────────────┘
```

### Server-side Neptune Strategy

A Groovy `TraversalStrategy` loaded at server startup (`scripts/neptune-init.groovy`) handles ALL Neptune semantics inside the Gremlin Server. This means any client that connects — Python, Java, JavaScript, Gremlin Console — gets Neptune-compatible behavior with no client-side changes.

**Multi-label matching:**
- `hasLabel("Person")` → matches vertices with label `"Person"`, `"Person::Employee"`, `"Employee::Person"`, etc.
- `hasLabel("Person::Employee")` → always returns false (Neptune behavior: compound labels in `hasLabel()` never match)
- `hasLabel(P.within("A", "B"))` → each target checked with `::` boundary-aware matching
- Chained `hasLabel("X").hasLabel("Y")` → TinkerPop merges into one `HasStep`; the strategy handles all containers

**UUID auto-generation:**
- `addV("Person")` without an explicit `T.id` property → server injects `UUID.randomUUID().toString()`, matching Neptune's behavior
- `addV("Person").property(T.id, "custom-id")` → uses the explicit ID as-is

**Set cardinality:**
- `defaultVertexPropertyCardinality=set` in `tinkergraph.properties` — duplicate property values are automatically deduplicated, matching Neptune's default

### Compatibility Guard

A static text-based linter that scans Gremlin query strings for patterns that would fail or behave differently on Neptune.

| Rule | Pattern | Example |
|------|---------|---------|
| `no-lambdas` | `{ ... -> }`, `Lambda.` | `g.V().filter{ it.get().value('age') > 30 }` |
| `no-groovy` | `System.`, `java.lang`, `new Date()` | `g.V().map{ System.nanoTime() }` |
| `no-variables` | Assignments, query not starting with `g.` | `x = 1; g.V(x)` |
| `must-start-with-g` | Query doesn't begin with `g.` | `graph.traversal().V()` |
| `no-graph-object` | References to `graph` | `graph.features()` |
| `no-list-cardinality` | `.property(list, ...)` | `g.V('x').property(list, 'tag', 'a')` |
| `no-program` | `.program(...)` | `g.V().program(pageRank)` |
| `no-sideeffect-consumer` | `.sideEffect({ ... })` | `g.V().sideEffect{ println it }` |
| `no-io-write` | `.io(...).write()` | `g.io('file.xml').write()` |
| `string-ids-only` | Numeric IDs in `g.V()` or `g.E()` | `g.V(123)` |
| `no-hasLabel-with-delimiter` | `hasLabel('X::Y')` | `g.V().hasLabel('Person::Employee')` |
| `no-materialize-properties` | `materializeProperties` | Any reference to this flag |
| `no-fqcn` | `org.apache.tinkerpop` | Fully qualified class names |
| `no-meta-properties` | `.properties().property(...)` | Meta-properties on vertex properties |

**Guard modes:**
- **`"strict"` (default):** Violations throw `NeptuneCompatError`. Use in CI/CD.
- **`"loose"`:** Violations logged as warnings. Use during exploration.

## Neptune vs TinkerGraph — Key Differences

The relationship is: **Neptune = subset(TinkerGraph) + multi-labels**.

### Features Neptune Removes

| Feature | TinkerGraph | Neptune | Impact |
|---------|-------------|---------|--------|
| Lambda steps | Supported | **Blocked** | No `{ it -> ... }`, no `Lambda.groovy(...)` |
| Groovy code | Supported | **Blocked** | No `System.nanoTime()`, `new Date()`, `java.lang.*` |
| Variables | Supported | **Blocked** | No `x = 1; g.V(x)` |
| `graph` object | Supported | **Blocked** | Only `g` is available |
| FQCNs | Supported | **Blocked** | Use short enum names (`single`, `OUT`, `asc`) |
| Vertex/edge ID types | Any | **String only** | `g.V(123)` fails |
| `list` cardinality | Supported | **Blocked** | Only `single` and `set` |
| Default cardinality | `list` | **`set`** | Duplicates silently deduplicated |
| MetaProperties | Supported | **Blocked** | Cannot add properties to properties |
| `materializeProperties` | Supported | **Blocked** | Properties must be fetched explicitly |
| `.program()` | Supported | **Blocked** | No OLAP vertex programs |
| `.sideEffect(Consumer)` | Supported | **Blocked** | Lambda-accepting overload only |
| `.from(Vertex)` / `.to(Vertex)` | Supported | **Blocked** | Use `.from('label')` or `.from(__.V('id'))` |
| `.io().write()` | Supported | **Blocked** | Only `.io().read()` |
| Session duration | Unlimited | **10 min max** | |

### Features Neptune Adds

**Multi-label vertices** — Neptune's only major addition:

```gremlin
// Creation: labels joined with ::
g.addV('Person::Employee::Manager').property(id, 'alice-1')

// Querying: hasLabel() matches any single component
g.V().hasLabel('Person')    // matches alice-1
g.V().hasLabel('Employee')  // matches alice-1

// hasLabel('Person::Employee') does NOT match — :: is only for addV()

// Label output returns the full compound string
g.V('alice-1').label()      // → "Person::Employee::Manager"
```

## Configuration

### TypeScript API

| Option | Default | Description |
|--------|---------|-------------|
| `host` | `"localhost"` | Gremlin Server host |
| `port` | `8182` | Gremlin Server port |
| `endpoint` | derived from host/port | Full WebSocket URL (overrides host/port) |
| `guardMode` | `"strict"` | `"strict"` throws on violations; `"loose"` warns only |

### Docker Compose (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEPTUNE_TINKER_PORT` | `8182` | Host port to expose |
| `NEPTUNE_TINKER_CONTAINER` | `neptune-tinker` | Docker container name |
| `NEPTUNE_TINKER_IMAGE` | `tinkerpop/gremlin-server:3.7.2` | Docker image |
| `NEPTUNE_TINKER_PERSIST` | `true` | Enable data persistence via named volume |

## Claude Integration

### Skills (for Claude Code)

Copy the `skills/` directory into your Claude skill path:

```bash
cp -r node_modules/neptune-tinker/skills/ .claude/skills/neptune/
```

- **`NEPTUNE_COMPAT.md`** — Reference for all Neptune constraints. Claude reads this before writing Gremlin.
- **`REVIEW_QUERY.md`** — Step-by-step procedure for Claude to review a Gremlin query for Neptune compatibility.

## Data Import / Export

### Import

```bash
neptune-tinker import data.json
```

Or programmatically:

```typescript
import { importFile } from 'neptune-tinker';
await importFile('data.json', sandbox);
```

### Export from Neptune

```bash
python scripts/export-neptune.py --endpoint your-neptune-endpoint --output data.json
```

## Known Limitations

- **Guard is text-based, not AST-based.** Regex patterns catch common issues but may miss edge cases in complex queries.
- **Chained `addV().property(k,v).property(k,v)` dedup.** During vertex creation, TinkerGraph doesn't deduplicate properties set in the same traversal chain. On updates (`g.V(id).property(k,v)`), set cardinality works correctly.
- **Session duration not enforced.** Neptune limits sessions to 10 minutes; the sandbox does not.

## Testing

```bash
pnpm run test              # all tests
pnpm run test:unit         # unit tests only
pnpm run test:integration  # integration (needs Docker)
pnpm run test:rival        # rival repo pattern tests
```

## License

MIT
