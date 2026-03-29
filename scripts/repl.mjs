import repl from "node:repl";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { NeptuneSandbox, lintQuery, guardQuery, parseMultiLabel, joinMultiLabel } =
  await import(join(__dirname, "..", "dist", "index.js"));
const gremlin = (await import("gremlin")).default;
const { P, TextP, t, cardinality, order, scope, column, direction, pop, withOptions } = gremlin.process;

const sandbox = new NeptuneSandbox();
await sandbox.connect();

console.log(`
  Neptune Sandbox REPL
  ────────────────────
  Local TinkerGraph with Neptune-compatible behavior.
  All queries use Neptune semantics — multi-label matching, set cardinality,
  string IDs. Write Gremlin the same way you would against real Neptune.

  What's different from raw TinkerGraph:
    - hasLabel("Person") matches "Person::Employee" vertices (multi-label)
    - .property("k","v") defaults to set cardinality (not list)
    - hasLabel("A::B") returns empty (Neptune behavior, not exact match)
    - .iterate() works (patched for gremlin-js 3.8 / TinkerPop 3.7 compat)

  Globals:
    g              Gremlin traversal source (Neptune-aware)
    __             Anonymous traversals for where()/filter()/not()
    sandbox        NeptuneSandbox instance — sandbox.addV() auto-generates UUIDs
    P, TextP       Predicates — P.gt(5), P.within("a","b"), TextP.containing("x")
    t              Tokens — t.id, t.label
    order          order.asc, order.desc
    cardinality    cardinality.single, cardinality.set
    scope, column, direction, pop, withOptions
    lint(query)    Check a Gremlin string for Neptune violations
    guard(query)   Same, but throws in strict mode

  Quick start:
    await g.addV("Org::Person").property(t.id, "p1").property("name", "Alice").next()
    await g.V().hasLabel("Person").elementMap().toList()
    await g.V().has("Person", "name", "Alice").values("name").toList()
    await g.V().hasLabel("Org").count().next()
    await g.V().order().by("name", order.desc).limit(5).values("name").toList()
    lint("g.V(123)")

  Data:
    Data persists across stop/start. Use 'neptune-tinker reset' to clear.
    Use 'neptune-tinker import data.json' to load exported Neptune data.
`);

const r = repl.start({ prompt: "neptune> ", useGlobal: true });

r.context.sandbox = sandbox;
r.context.g = sandbox.g;
r.context.__ = sandbox.__;
r.context.lint = (q) => lintQuery(q, sandbox.config.guardMode);
r.context.guard = (q) => guardQuery(q, sandbox.config.guardMode);
r.context.parseMultiLabel = parseMultiLabel;
r.context.joinMultiLabel = joinMultiLabel;
r.context.P = P;
r.context.TextP = TextP;
r.context.t = t;
r.context.cardinality = cardinality;
r.context.order = order;
r.context.scope = scope;
r.context.column = column;
r.context.direction = direction;
r.context.pop = pop;
r.context.withOptions = withOptions;

r.on("exit", async () => {
  await sandbox.close();
  process.exit(0);
});
