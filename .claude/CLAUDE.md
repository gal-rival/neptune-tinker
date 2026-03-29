# neptune-tinker

## What this project is

An npm package (`neptune-tinker`) providing a Neptune-compatible local dev sandbox using TinkerGraph in Docker. Ships with Claude skills for Neptune-safe Gremlin.

**Core insight:** Neptune = subset(TinkerGraph) + multi-labels. This package bridges the gap with server-side and client-side compatibility layers.

## Architecture

```
src/
├── types.ts              ← Config, Neptune constraint constants
├── multilabel.ts         ← :: label parsing utilities
├── guard.ts              ← Regex-based Gremlin linter (14+ rules)
├── neptune-traversal.ts  ← GraphTraversal/Source subclasses (JS middleware)
├── sandbox.ts            ← Programmatic Docker compose launcher
├── import.ts             ← JSON graph data import engine
├── gremlin.d.ts          ← Type declarations for untyped gremlin package
└── index.ts              ← NeptuneSandbox class, re-exports

scripts/
├── docker-compose.yml    ← Gremlin Server + TinkerGraph, env-var configurable
├── gremlin-server.yaml   ← Server config (all GraphSON versions + GraphBinary)
├── tinkergraph.properties ← set cardinality, ANY id manager, persistence
├── neptune-init.groovy   ← Server-side NeptuneMultiLabelStrategy (all clients)
├── export-neptune.py     ← Python script to export from AWS Neptune
├── repl.mjs              ← Interactive REPL with middleware
├── console-init.groovy   ← Gremlin Console auto-connect
└── remote-console.yaml   ← Console connection config

bin/
└── neptune-tinker.mjs    ← CLI: start/stop/reset/health/logs/console/repl/import

skills/
├── NEPTUNE_COMPAT.md     ← Neptune constraint reference
└── REVIEW_QUERY.md       ← Query review procedure
```

## How Neptune compat works

### Server-side (all clients — Python, Java, JS)
- `NeptuneMultiLabelStrategy` (Groovy) intercepts `HasStep` with `T.label` predicates and rewrites to `::` boundary-aware matching
- `defaultVertexPropertyCardinality=set` in tinkergraph.properties
- GraphSON v1/v2/v3 + GraphBinary serializers for wire format compat

### Client-side (JS middleware via NeptuneSandbox)
- `NeptuneGraphTraversal` subclass overrides: `property()` (set cardinality), `hasLabel()` (multi-label), `has()` (t.label + 3-arg forms), `iterate()` (3.8 compat)
- `sandbox.__` provides Neptune-aware anonymous traversals for `where()`/`filter()`/`not()`
- `sandbox.addV()` auto-generates UUID string IDs

### Guard (string queries)
- 14+ regex rules catching: lambdas, Groovy, numeric IDs, `hasLabel("A::B")`, `graph.`, list cardinality, etc.

## Neptune constraints (quick reference)

- IDs are strings only
- No lambdas, Groovy, variables, `graph` object
- Cardinality: `single` and `set` only (default `set`)
- No MetaProperties, `materializeProperties`, FQCNs
- Multi-labels: `addV('A::B::C')` creates 3 labels; `hasLabel('A')` matches; `hasLabel('A::B')` does NOT match
- Unsupported: `program()`, `sideEffect(Consumer)`, `from(Vertex)`, `to(Vertex)`, `io().write()`

## CLI

```bash
neptune-tinker start [--port N] [--no-persist]
neptune-tinker stop|reset|health|logs
neptune-tinker console|repl
neptune-tinker import <file.json>
```

## Testing

```bash
pnpm run test          # all tests (204)
pnpm run test:unit     # unit tests only
pnpm run test:integration  # integration (needs Docker)
pnpm run test:rival    # rival repo pattern tests
```
