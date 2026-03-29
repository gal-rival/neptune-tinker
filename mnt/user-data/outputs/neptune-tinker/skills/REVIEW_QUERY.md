# Review Gremlin Query for Neptune Compatibility — Claude Skill

## Purpose
When asked to review a Gremlin query, check it against Neptune's constraints and
suggest fixes. Use NEPTUNE_COMPAT.md as the reference.

## Review Procedure

### Step 1: Structural Check
1. Does the query start with `g.`?
2. Are there multiple statements? If so, are all but the last terminated with `.iterate()`?
3. Is there any Groovy/Java code (variables, imports, math, system calls)?

### Step 2: ID Check
Scan for `g.V(...)`, `g.E(...)`, `.property(id, ...)` patterns.
All ID values must be quoted strings. Flag any numeric or unquoted IDs.

### Step 3: Lambda Check
Look for `{ ... -> ... }`, `Lambda.groovy(...)`, `Lambda.function(...)`.
These are always incompatible. Suggest equivalent built-in step alternatives.

### Step 4: Cardinality Check
Look for `.property(list, ...)` — this is not supported.
Look for `.property('key', 'val')` without explicit cardinality — note that Neptune
defaults to `set` (not `list`), so behavior may differ from local TinkerGraph.

### Step 5: Label Check
- `hasLabel('X::Y')` — this is always wrong in Neptune. Flag it.
- `addV('X::Y')` — this is correct (creates multi-label vertex).
- Verify the query isn't assuming single-label semantics when multi-label is in play.

### Step 6: Unsupported API Check
Flag usage of:
- `.program(...)`
- `.sideEffect({ ... })` (lambda form)
- `.from(vertex)` / `.to(vertex)` with resolved vertex objects
- `.io(...).write()`
- `graph.*` (the graph object)
- Fully qualified class names (`org.apache.tinkerpop...`)
- `materializeProperties`

### Step 7: Serialization / Output Assumptions
Neptune returns vertices/edges as references (id + label only).
If the query or surrounding code assumes properties come back on elements
without explicit `.valueMap()` / `.elementMap()` / `.properties()`, flag it.

## Response Format

```
## Neptune Compatibility Review

**Query:**
[paste the query]

**Issues Found:** N

1. **[rule-name]** (line/position if applicable)
   Problem: ...
   Fix: ...

2. ...

**Verdict:** ✅ Compatible | ⚠️ Warnings | ❌ Incompatible
```

## Common Rewrites

### Lambda → Built-in
```
// Bad: filter with lambda
g.V().filter{ it.get().value('age') > 30 }

// Good: predicate
g.V().has('age', gt(30))
```

### Numeric ID → String ID
```
// Bad
g.V(1).out('knows')

// Good
g.V('1').out('knows')
```

### List cardinality → Set
```
// Bad
g.V('x').property(list, 'tag', 'a')

// Good
g.V('x').property(set, 'tag', 'a')
```

### hasLabel with :: → single label
```
// Bad (never matches in Neptune)
g.V().hasLabel('Person::Employee')

// Good (matches any vertex that has Person as one of its labels)
g.V().hasLabel('Person')
```

### graph object → traversal
```
// Bad
graph.traversal().V()

// Good
g.V()
```
