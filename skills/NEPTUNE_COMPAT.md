# Neptune Gremlin Compatibility — Claude Skill

## Purpose
When writing Gremlin queries intended for Amazon Neptune, follow these constraints.
Neptune is a subset of TinkerPop Gremlin with one major addition: multi-labels.

---

## HARD RULES — Never Do These

### 1. No Lambdas
Neptune does not support lambda steps. Never write `{ it -> ... }` or `Lambda.groovy(...)`.
Always use built-in Gremlin steps instead.

**Bad:** `g.V().map{ it.get().value('name').toUpperCase() }`
**Good:** `g.V().values('name')` (do string transforms app-side)

### 2. No Groovy / Java
No `System.nanoTime()`, `new Date()`, `java.lang.*`, math operators like `1+1`.
Queries are pure Gremlin, not Groovy scripts.

### 3. Queries Must Start With `g.`
The `graph` object is not available. No `graph.features()`, `graph.traversal()`, etc.

### 4. No Variables or Parameterization
No `x = 1; g.V(x)`. No bindings. Submit queries directly — Neptune has no performance
penalty for non-parameterized queries (it uses ANTLR grammar, not GremlinGroovyScriptEngine).

### 5. String IDs Only
Vertex and edge IDs must be strings. Never `g.V(123)` — always `g.V('123')`.
If you don't supply an ID, Neptune generates a UUID string.

### 6. No `list` Cardinality
Only `single` and `set` cardinality are supported for vertex properties.
Neptune's **default is `set`** (TinkerGraph defaults to `list`).

**Bad:** `g.V('x').property(list, 'phone', '555-1234')`
**Good:** `g.V('x').property(set, 'phone', '555-1234')`

### 7. No MetaProperties
`MetaProperties` feature is disabled. You cannot add properties to properties.

### 8. No Fully Qualified Class Names
Use short enum names: `single`, `set`, `OUT`, `asc`, `desc`.
Not `org.apache.tinkerpop.gremlin.structure.VertexProperty.Cardinality.single`.

### 9. No `materializeProperties`
Neptune always returns vertices/edges as references (id + label only).
Fetch properties explicitly with `.valueMap()` or `.properties()`.

---

## Multi-Label Support (Neptune Addition)

Neptune supports multiple labels per vertex using `::` as a delimiter.

### Creating Multi-Label Vertices
```gremlin
g.addV('Person::Employee').property(id, 'alice-1').property('name', 'Alice')
```
This creates a vertex with labels `Person` AND `Employee`.

### Querying Multi-Label Vertices
```gremlin
// Matches — any single component label works:
g.V().hasLabel('Person')     // ✅ matches
g.V().hasLabel('Employee')   // ✅ matches

// Does NOT match — compound label with :: is treated as literal:
g.V().hasLabel('Person::Employee')   // ❌ never matches anything
```

### Label Output
`g.V('alice-1').label()` returns `"Person::Employee"` (the full joined string).

### Appending Labels
If you `addV` with an existing ID but a new label, Neptune appends the label:
```gremlin
g.addV('Person').property(id, 'v1')
g.addV('Admin').property(id, 'v1')
g.V('v1').label()   // → "Person::Admin"
```

---

## Unsupported Steps/Methods

| Pattern | Why |
|---------|-----|
| `.program(vertexProgram)` | No OLAP/VertexProgram support |
| `.sideEffect(consumer)` | Only `.sideEffect(traversal)` is allowed |
| `.from(vertex)` / `.to(vertex)` | Cannot pass resolved Vertex objects in string queries. Use `.from('label')` or `.from(__.V('id'))` |
| `.io(url).write()` | Only `.io(url).read()` is supported |

---

## Cardinality Defaults

| Operation | Neptune Default | TinkerGraph Default |
|-----------|----------------|---------------------|
| `property('key', 'val')` | **set** | list |
| `property(single, 'key', 'val')` | single | single |

This means in Neptune, `g.V('x').property('color', 'red').property('color', 'blue')` results in
`color = {'red', 'blue'}` (a set), not a list. Duplicate values are deduplicated.

---

## Safe Patterns Checklist

When writing a Neptune query, verify:
- [ ] Starts with `g.`
- [ ] All IDs are quoted strings
- [ ] No lambdas, no Groovy
- [ ] Cardinality is `single` or `set` (never `list`)
- [ ] `hasLabel()` uses a single component label (no `::`)
- [ ] No `graph` object references
- [ ] No fully qualified Java class names
- [ ] Properties fetched explicitly (no reliance on materializeProperties)
