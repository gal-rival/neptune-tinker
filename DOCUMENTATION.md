# neptune-tinker — Design & Reference Documentation

## The Problem

Amazon Neptune uses Apache TinkerPop Gremlin as its query language, but its implementation diverges from the standard TinkerPop/TinkerGraph reference in two directions: it **removes** a set of features, and it **adds** one important capability (multi-label vertices). This creates a gap that makes local development unreliable. Code written against a local TinkerGraph may silently use features that will fail in production on Neptune, and Neptune's multi-label semantics don't exist locally at all.

There is no official "Neptune local mode." The typical workaround is to run TinkerGraph in Docker and hope for the best, then discover incompatibilities during integration testing. This is slow, expensive, and particularly hostile to AI-assisted development, where a coding agent has no way to know it's generating Neptune-incompatible Gremlin unless it's been told.

`neptune-tinker` closes this gap with three layers: a Docker-based TinkerGraph sandbox, a middleware that emulates Neptune's multi-label semantics, and a guard/lint system that catches incompatible query patterns at dev time. It ships with documentation formatted as Claude skills so that AI agents can write Neptune-safe Gremlin from the start.

---

## Neptune vs TinkerGraph: Complete Difference Map

The relationship is: **Neptune ⊂ TinkerGraph + multi-labels**. Neptune supports a strict subset of TinkerGraph's features, plus the `::` multi-label extension that TinkerGraph doesn't have.

### Features Neptune Removes

#### Query Language Restrictions

| Feature | TinkerGraph | Neptune | Impact |
|---------|-------------|---------|--------|
| Lambda steps | Supported | **Blocked** | No `{ it -> ... }`, no `Lambda.groovy(...)`. All filtering, mapping, and side-effects must use built-in Gremlin steps. |
| Groovy code | Supported | **Blocked** | No `System.nanoTime()`, `new Date()`, `java.lang.*`, arithmetic like `1+1`. Neptune uses an ANTLR grammar, not GremlinGroovyScriptEngine. |
| Variables | Supported | **Blocked** | No `x = 1; g.V(x)`. No parameterized bindings. Queries are submitted directly as strings with no performance penalty. |
| `graph` object | Supported | **Blocked** | Only the `g` traversal object is pre-bound. No `graph.features()`, `graph.traversal()`, `graph.io()`. |
| Fully qualified class names | Supported | **Blocked** | Must use short enum names (`single`, `OUT`, `asc`). Not `org.apache.tinkerpop.gremlin.structure.VertexProperty.Cardinality.single`. |

#### Data Model Restrictions

| Feature | TinkerGraph | Neptune | Impact |
|---------|-------------|---------|--------|
| Vertex/edge ID types | Any (string, int, UUID, custom) | **String only** | `g.V(123)` fails. Must be `g.V('123')`. Neptune generates UUID strings if no ID is supplied. |
| `list` cardinality | Supported | **Blocked** | Only `single` and `set` are available. |
| Default cardinality | `list` | **`set`** | `g.V('x').property('tag', 'a').property('tag', 'b')` produces a list `['a','b']` in TinkerGraph but a set `{'a','b'}` in Neptune. Duplicates are silently deduplicated in Neptune. |
| MetaProperties | Supported | **Blocked** | Cannot add properties to properties. |
| Vertex property user-supplied IDs | Supported | **Blocked** | Vertex property IDs are auto-generated (can be positive or negative numbers). |
| `materializeProperties` | Supported (3.7.0+) | **Blocked** | Vertices and edges are always returned as references (id + label only). Properties must be fetched explicitly. |

#### API Restrictions

| Method/Step | TinkerGraph | Neptune | Notes |
|-------------|-------------|---------|-------|
| `.program(VertexProgram)` | Supported | **Blocked** | No OLAP vertex programs. |
| `.sideEffect(Consumer)` | Supported | **Blocked** | Lambda-accepting overload. `.sideEffect(traversal)` is fine. |
| `.from(Vertex)` / `.to(Vertex)` | Supported | **Blocked** | Cannot pass resolved Vertex objects in string-mode queries. Use `.from('stepLabel')` or `.from(__.V('id'))` instead. |
| `.io(url).write()` | Supported | **Blocked** | Only `.io(url).read()` is supported. |
| `tx.commit()` / `tx.rollback()` | Supported | **Blocked** | Neptune manages transactions automatically per traversal. Multi-statement queries (separated by `;` or `\n`) are a single transaction. |

#### Infrastructure Restrictions

| Feature | TinkerGraph | Neptune |
|---------|-------------|---------|
| Session duration | Unlimited | **10 minutes max** |
| Script execution | Arbitrary | **Must start with `g.`**; multi-statement separated by `;` or `\n`, all but last must end with `.iterate()` |
| Serialization | All TinkerPop serializers | Same set, but guidance is to use GraphBinary (drivers) or untyped GraphSON 3 (HTTP) |

### Features Neptune Adds

#### Multi-Label Vertices

This is Neptune's only major addition over standard TinkerPop.

**Creation:** Labels are joined with `::` as a delimiter.

```gremlin
g.addV('Person::Employee::Manager').property(id, 'alice-1').property('name', 'Alice')
```

This creates a single vertex with three independent labels: `Person`, `Employee`, `Manager`.

**Querying:** `hasLabel()` matches any single component.

```gremlin
g.V().hasLabel('Person')    // matches alice-1
g.V().hasLabel('Employee')  // matches alice-1
g.V().hasLabel('Manager')   // matches alice-1
```

**Critical gotcha:** `hasLabel('Person::Employee')` does **not** match. The `::` delimiter is only valid in `addV()`. In `hasLabel()`, it's treated as a literal string that won't equal any label.

**Label output:** `g.V('alice-1').label()` returns the full compound string: `"Person::Employee::Manager"`.

**Label appending:** If you call `addV` with an existing vertex ID and a new label, Neptune doesn't fail or overwrite — it appends the new label and any additional properties.

```gremlin
g.addV('Person').property(id, 'v1')
g.addV('Admin').property(id, 'v1')    // same ID, new label
g.V('v1').label()                     // → "Person::Admin"
```

The `::` delimiter is reserved exclusively for this multi-label purpose.

---

## The Solution

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Application / AI Agent                                  │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐   │
│  │  NeptuneSandbox  │  │  Guard Layer                 │   │
│  │                  │  │                              │   │
│  │  .addV()         │  │  .lint(query) → violations[] │   │
│  │  .submit(query)  │  │  .guard(query) → throw/warn  │   │
│  │                  │  │                              │   │
│  └────────┬─────────┘  └──────────────────────────────┘   │
│           │                                               │
│  ┌────────▼─────────┐                                     │
│  │  Multi-Label      │                                    │
│  │  Middleware (JS)   │                                    │
│  │  + Server-side     │                                    │
│  │  Strategy (Groovy) │                                    │
│  │                    │                                    │
│  └────────┬───────────┘                                   │
│           │  gremlin-javascript (WebSocket)                │
└───────────┼───────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────┐
│  Docker Container                                         │
│  Gremlin Server 3.7.2 + TinkerGraph (in-memory)          │
│  Port configurable (default 8182)                         │
└───────────────────────────────────────────────────────────┘
```

### Layer 1: Docker Sandbox

A stock TinkerPop Gremlin Server image (`tinkerpop/gremlin-server:3.7.2`) running TinkerGraph in-memory. The server configuration disables Groovy script processing and only enables the `gremlin-lang` ANTLR grammar, matching Neptune's query processing model.

The sandbox is managed through standalone shell scripts (`scripts/*.sh`) that wrap plain `docker run` — no docker-compose required. All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEPTUNE_TINKER_PORT` | `8182` | Host port to expose |
| `NEPTUNE_TINKER_CONTAINER` | `neptune-tinker` | Docker container name |
| `NEPTUNE_TINKER_IMAGE` | `tinkerpop/gremlin-server:3.7.2` | Docker image to use |
| `NEPTUNE_TINKER_INTERNAL_PORT` | same as PORT | Port inside the container |

```bash
# Default (port 8182)
npm run sandbox:start

# Custom port
NEPTUNE_TINKER_PORT=9182 npm run sandbox:start

# Multiple sandboxes (different port + container name)
NEPTUNE_TINKER_PORT=9182 NEPTUNE_TINKER_CONTAINER=neptune-a npm run sandbox:start
NEPTUNE_TINKER_PORT=9183 NEPTUNE_TINKER_CONTAINER=neptune-b npm run sandbox:start

# Health check
npm run sandbox:health

# Reset (stop + start, clears all data)
npm run sandbox:reset

# Stop
npm run sandbox:stop
```

The scripts are also installed as CLI commands via `bin` (`neptune-tinker-start`, `neptune-tinker-stop`, `neptune-tinker-health`, `neptune-tinker-reset`), so downstream projects can call them without `npm run`.

The start script generates a Gremlin Server YAML from the template (`scripts/gremlin-server.template.yaml`) with the configured port injected, mounts it into the container, and polls the health endpoint until ready.

### Layer 2: Multi-Label Emulation

TinkerGraph doesn't support multi-label vertices. The sandbox emulates Neptune's `::` semantics at two levels:

#### Server-side: `NeptuneMultiLabelStrategy` (all clients)

A Groovy `TraversalStrategy` loaded at server startup (`scripts/neptune-init.groovy`) that intercepts `HasStep` with `T.label` predicates and rewrites them to `::` boundary-aware matching. This works for **all clients** — Python, Java, JavaScript, Gremlin Console — because it runs inside the Gremlin Server itself.

How it works:
- `hasLabel("Person")` → replaced with a `LambdaFilterStep` that checks if the vertex label equals `"Person"`, starts with `"Person::"`, ends with `"::Person"`, or contains `"::Person::"`
- `hasLabel("Person::Employee")` → replaced with a filter that always returns false (Neptune behavior: compound labels never match)
- `hasLabel(P.within("A", "B"))` → each target checked with boundary-aware matching
- Chained `hasLabel("org").hasLabel("Finding")` → TinkerPop merges into one `HasStep` with two containers; the strategy handles both

#### Client-side: `NeptuneGraphTraversal` (JS middleware)

For JavaScript clients using `NeptuneSandbox`, the traversal subclass provides additional overrides:
- `property()` defaults to `set` cardinality
- `has(t.label, value)` routes through multi-label `hasLabel()`
- `has(label, key, value)` decomposes to `hasLabel(label).has(key, value)`
- `iterate()` maps to `toList()` (gremlin-js 3.8 compat with TinkerPop 3.7.2)
- `sandbox.__` provides Neptune-aware anonymous traversals for `where()`/`filter()`/`not()`

### Layer 3: Compatibility Guard

The guard is a static text-based linter that scans Gremlin query strings for patterns that would fail or behave differently on Neptune. It runs automatically when you use `sandbox.submit(query)` and is available standalone via `sandbox.lint(query)`.

#### What It Catches

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

#### Guard Modes

**`"strict"` (default):** All violations are errors. `sandbox.guard(query)` throws a `NeptuneCompatError` with the full list of violations. Use this in CI/CD or when you want hard guarantees.

**`"loose"`:** All violations are warnings, logged to `console.warn`. The query is allowed to proceed. Use this during exploratory development when you want awareness without friction.

The mode is set at sandbox construction time and applies to all `guard()` and `submit()` calls. You can always call `lint()` directly to get the raw violation list regardless of mode.

---

## Usage Guide

### Installation

```bash
npm install neptune-tinker
```

### Starting the Sandbox

```bash
# Requires Docker. Default port 8182.
npm run sandbox:start

# Custom port
NEPTUNE_TINKER_PORT=9182 npm run sandbox:start

# Verify
npm run sandbox:health
```

### Basic Usage

```typescript
import { NeptuneSandbox } from 'neptune-tinker';

const sandbox = new NeptuneSandbox({
  port: 9182,                        // match your script port
  // host: 'localhost',              // default
  // endpoint: 'ws://...',           // overrides host/port if set
  guardMode: 'strict',
  guardMode: 'strict',
});

await sandbox.connect();

// Create vertices with Neptune-style multi-labels
await sandbox.addV('Person::Employee', { name: 'Alice', dept: 'Engineering' }, 'alice-1');
await sandbox.addV('Person::Manager', { name: 'Bob', dept: 'Engineering' }, 'bob-1');
await sandbox.addV('Project', { name: 'Neptune Migration' }, 'proj-1');

// Query by single label component
const allPeople = await sandbox.g.V().hasLabel('Person').toList();
// → [alice-1, bob-1]

const managers = await sandbox.g.V().hasLabel('Manager').toList();
// → [bob-1]

// Use the traversal source directly for standard Gremlin
const g = sandbox.g;
await g.V('alice-1').addE('worksOn').to(g.V('proj-1')).next();

// Lint a query string
const issues = sandbox.lint(`g.V(123).hasLabel('A::B')`);
// → [
//   { rule: 'string-ids-only', message: '...', severity: 'error' },
//   { rule: 'no-hasLabel-with-delimiter', message: '...', severity: 'error' }
// ]

// Submit a raw Gremlin string (guarded)
const result = await sandbox.submit(`g.V('alice-1').valueMap()`);

// Resolved config is available on the instance
console.log(sandbox.config.endpoint); // ws://localhost:9182/gremlin

await sandbox.close();
```

### Using the Guard Standalone

```typescript
import { lintQuery, guardQuery } from 'neptune-tinker';

// Get violations without throwing
const violations = lintQuery(`g.V().filter{ it.get().value('age') > 30 }`, 'strict');
console.log(violations);
// → [{ rule: 'no-lambdas', message: '...', severity: 'error' }]

// Throw on violations
guardQuery(`g.V('1').out('knows').values('name')`, 'strict');
// → No error (this query is Neptune-compatible)
```

---

## Claude Skills Integration

The `skills/` directory contains two Markdown files designed to be loaded as Claude Code custom skills or included in system prompts.

### NEPTUNE_COMPAT.md

A reference document that lists every Neptune constraint with examples of correct and incorrect patterns. When Claude reads this before writing Gremlin, it avoids generating code that uses lambdas, numeric IDs, list cardinality, the graph object, or any other Neptune-incompatible pattern. It also documents multi-label creation and querying semantics so Claude can use `::` labels correctly.

### REVIEW_QUERY.md

A step-by-step procedure for auditing a Gremlin query against Neptune's constraints. It walks through structural checks, ID validation, lambda detection, cardinality verification, label semantics, unsupported API usage, and serialization assumptions. The output format is a structured review with a verdict.

### How to Use with Claude Code

Copy the skills into your Claude Code skill directory:

```bash
cp -r node_modules/neptune-tinker/skills/ .claude/skills/neptune/
```

Then reference them in your Claude Code configuration. When Claude is asked to write or review Gremlin, it will read these skills first and apply the constraints automatically.

### How to Use in a System Prompt

Include the contents of `NEPTUNE_COMPAT.md` in the system prompt for any Claude conversation where Gremlin will be written. This is the most direct integration — Claude will have the full constraint set in context for every query it generates.

---

## Known Limitations

**Multi-label append behavior is not emulated.** In Neptune, calling `addV('Label2').property(id, 'existing-id')` appends `Label2` to the existing vertex's labels. In the sandbox, TinkerGraph will throw a duplicate ID error. This is a rare pattern but worth knowing about. A future version could intercept `addV` calls and check for existing IDs.

**Guard is text-based, not AST-based.** The linter uses regex patterns, not a Gremlin parser. It catches the most common incompatibilities but can miss edge cases in complex or dynamically constructed queries. It will never produce false negatives for the patterns it checks, but it may miss novel incompatible patterns.

**Default cardinality mismatch is not transparently fixed.** Neptune defaults to `set` cardinality; TinkerGraph defaults to `list`. The `addV()` helper on NeptuneSandbox explicitly sets `set` cardinality for all properties, but if you use the `g` traversal source directly without specifying cardinality, TinkerGraph will use `list`. The guard cannot catch this because it's a semantic difference, not a syntactic one.

**In-memory only.** The Docker sandbox uses TinkerGraph, which is in-memory. Data does not survive container restarts. This is intentional — the sandbox is for development and testing, not persistence. Use `npm run sandbox:reset` to clear state.

**Session duration is not enforced.** Neptune limits sessions to 10 minutes. The sandbox does not enforce this. If your code relies on long-lived sessions, it will work locally but may fail in production.

---

## Appendix: Neptune Graph Feature Flags

These are the feature flags Neptune would return from `graph.features()` (which itself is not accessible in Neptune, but the flags describe the engine's capabilities).

### Graph Features

| Feature | Value |
|---------|-------|
| Transactions | true |
| ThreadedTransactions | false |
| Computer | false |
| Persistence | true |
| ConcurrentAccess | true |

### Vertex Features

| Feature | Value |
|---------|-------|
| AddVertices | true |
| RemoveVertices | true |
| MultiProperties | true |
| DuplicateMultiProperties | false |
| MetaProperties | false |
| UserSuppliedIds | true (string only) |
| NumericIds | false |
| StringIds | true |
| UuidIds | false |
| CustomIds | false |

### Edge Features

| Feature | Value |
|---------|-------|
| AddEdges | true |
| RemoveEdges | true |
| UserSuppliedIds | true (string only) |
| NumericIds | false |
| StringIds | true |
| UuidIds | false |

### Vertex Property Features

| Feature | Value |
|---------|-------|
| Properties | true |
| UserSuppliedIds | false |
| BooleanValues | true |
| ByteValues | true |
| DoubleValues | true |
| FloatValues | true |
| IntegerValues | true |
| LongValues | true |
| StringValues | true |
| MapValues | false |
| MixedListValues | false |
| SerializableValues | false |
| All array types | false |

### Edge Property Features

Same as vertex property features (BooleanValues through StringValues are true; all others are false).

### Variable Features

All variable features are **false**. Neptune does not support graph variables.
