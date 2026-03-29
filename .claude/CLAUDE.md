# neptune-tinker

## What this project is

An npm package (`neptune-tinker`) that provides a Neptune-compatible local development sandbox using TinkerGraph. It's Claude-first — meaning it ships with skills and documentation designed for AI agents to write Neptune-safe Gremlin.

The core insight: **Neptune = subset(TinkerGraph) + multi-labels**. Neptune removes features (lambdas, Groovy, list cardinality, numeric IDs, etc.) and adds one: multi-label vertices via `::` delimiter syntax. This package bridges the gap.

## Current state

The project has been scaffolded but NOT yet validated. The following files exist:

### Source (`src/`)
- `types.ts` — Config types, `resolveConfig()`, Neptune constraint constants
- `multilabel.ts` — Multi-label emulation (two strategies: `"delimiter"` and `"property"`)
- `guard.ts` — Static regex-based linter that catches Neptune-incompatible Gremlin patterns
- `index.ts` — `NeptuneSandbox` class wrapping `gremlin-javascript`, re-exports everything

### Infrastructure (`scripts/`)
- `docker-compose.yml` — Gremlin Server 3.7.2 + TinkerGraph, configurable via env vars (`NEPTUNE_TINKER_PORT`, `NEPTUNE_TINKER_CONTAINER`, `NEPTUNE_TINKER_IMAGE`)
- `gremlin-server.yaml` — Server config (ANTLR grammar only, no Groovy)
- `.env.example` — Documents available env vars

### Documentation
- `skills/NEPTUNE_COMPAT.md` — Claude skill: full Neptune constraint reference
- `skills/REVIEW_QUERY.md` — Claude skill: step-by-step query review procedure
- `DOCUMENTATION.md` — Human-readable design doc covering the full Neptune/TinkerGraph diff, architecture, all three layers, usage guide, known limitations
- `README.md` — Quick start and overview

### Config
- `package.json` — npm scripts wrap `docker compose`, deps are `gremlin` + `typescript`
- `tsconfig.json` — ESM, ES2022, strict

## What needs to happen next

### Must do (in priority order)

1. **`npm install` and `tsc` — make it compile.** The code was written without running the compiler. There will be type errors, import issues, and possibly wrong assumptions about the `gremlin` package's TypeScript API. Fix whatever breaks. The `gremlin` package has poor/incomplete types — you may need `@ts-expect-error` or local type declarations in a `src/gremlin.d.ts`.

2. **Validate the Gremlin Server config.** The `gremlin-server.yaml` references serializer class names that changed in TinkerPop 3.7.0 (e.g., `GraphBinaryMessageSerializerV4` may or may not exist in the 3.7.2 image). Run `npm run sandbox:start` and check `npm run sandbox:logs` for errors. Fix the YAML if the server doesn't start. The image's default config at `/opt/gremlin-server/conf/` inside the container is the source of truth for valid class names.

3. **Write tests.** At minimum:
   - Guard/lint: unit tests for each rule (lambdas, numeric IDs, hasLabel with ::, list cardinality, etc.)
   - Multi-label: test both strategies (delimiter and property) — addV with multi-label, V_byLabel matching, label() output
   - Integration: connect to the Docker sandbox, run queries, verify results
   
   Use `vitest` or Node's built-in test runner. Tests that need Docker should be skippable (check if port is open before running).

4. **Fix the delimiter strategy's `V_byLabel` implementation.** The current filter uses `TextP.containing()` which has edge cases — e.g., label `"Admin"` would false-match on `"AdminAssistant::Manager"` because `"Admin"` is a substring. The filter needs to match on `::` boundaries properly. Think about: exact match OR `startsWith(label + "::")` OR `endsWith("::" + label)` OR `contains("::" + label + "::")`.

5. **Verify `gremlin` package API usage.** The code uses `gprocess.statics`, `gprocess.P`, `gprocess.TextP`, `gprocess.cardinality`, `gprocess.t` — verify these exist in `gremlin@3.7.2`'s JS API. The JavaScript driver's API surface differs from the Java one; some things may be at different paths.

### Should do

6. **Add a programmatic `startSandbox()` function** in TypeScript that shells out to `docker compose` (using `child_process.execSync`). This lets consumers start the sandbox from code/tests without needing npm scripts. Respect the same env vars.

7. **`.gitignore`** — `node_modules/`, `dist/`, `.env`

8. **CI-friendly test setup** — A GitHub Actions workflow that starts the Docker sandbox, runs tests, tears down.

### Nice to have

9. **MCP server** — Expose the sandbox as a Claude Code MCP tool with `execute_gremlin`, `lint_query`, `reset_sandbox` tools. This is the "Claude-first" endgame.

10. **Default cardinality enforcement** — When using `sandbox.g` directly (bypassing `addV()`), TinkerGraph still defaults to `list` cardinality. Consider a warning mechanism or a wrapper that intercepts `.property()` calls.

## Architecture

```
src/
├── types.ts        ← Config, constants, resolveConfig()
├── multilabel.ts   ← :: label parsing, both strategies
├── guard.ts        ← lintQuery(), guardQuery(), NeptuneCompatError
└── index.ts        ← NeptuneSandbox class, re-exports

scripts/
├── docker-compose.yml   ← env-var configurable
├── gremlin-server.yaml  ← mounted into container
└── .env.example

skills/
├── NEPTUNE_COMPAT.md    ← Claude skill: what NOT to do in Neptune
└── REVIEW_QUERY.md      ← Claude skill: review procedure
```

## Key design decisions

- **Docker compose, not custom scripts** — compose handles health checks, env var interpolation, and cleanup natively. The `--wait` flag blocks until healthy.
- **Two multi-label strategies** — `"delimiter"` (cheap, stores `A::B::C` as native label) and `"property"` (accurate, uses hidden `__labels` property). Default is delimiter.
- **Guard is text-based** — regex patterns, not AST parsing. Catches common issues, not exhaustive. This is intentional — a full Gremlin parser would be a massive dependency.
- **Config takes `host`/`port` OR full `endpoint`** — `resolveConfig()` derives the WebSocket URL. `endpoint` overrides if set.
- **No opinions on test framework** — pick vitest, jest, or node:test.

## Neptune constraints (quick reference for writing code)

- Queries must start with `g.`
- IDs are strings only (no `g.V(123)`)
- No lambdas, no Groovy, no `graph` object, no variables
- Cardinality: only `single` and `set` (default is `set`, NOT `list`)
- No MetaProperties, no `materializeProperties`
- Multi-labels: `addV('A::B::C')` creates 3 labels; `hasLabel('A')` matches; `hasLabel('A::B')` does NOT match
- Unsupported: `program()`, `sideEffect(Consumer)`, `from(Vertex)`, `to(Vertex)`, `io().write()`

Read `skills/NEPTUNE_COMPAT.md` for the full reference.
