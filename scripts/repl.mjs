import repl from "node:repl";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { NeptuneSandbox, lintQuery, guardQuery, parseMultiLabel, joinMultiLabel } =
  await import(join(__dirname, "..", "dist", "index.js"));

const sandbox = new NeptuneSandbox();
await sandbox.connect();

console.log("\n  Neptune Sandbox REPL — middleware loaded\n");
console.log("  Globals:");
console.log("    sandbox   — NeptuneSandbox instance (connected)");
console.log("    g         — Gremlin traversal source");
console.log("    lint(q)   — lint a Gremlin string");
console.log("    guard(q)  — guard a Gremlin string (throws in strict)");
console.log("    __        — Neptune-aware anonymous traversal helpers");
console.log("");
console.log("  Examples:");
console.log('    await sandbox.addV("Person::Employee", { name: "Alice" }, "a1")');
console.log('    await g.V().hasLabel("Person").toList()');
console.log('    await g.V().count().next()');
console.log('    await g.V().where(__.hasLabel("Person")).toList()');
console.log('    lint("g.V(123)")');
console.log("");

const r = repl.start({ prompt: "neptune> ", useGlobal: true });

r.context.sandbox = sandbox;
r.context.g = sandbox.g;
r.context.__ = sandbox.__;
r.context.lint = (q) => lintQuery(q, sandbox.config.guardMode);
r.context.guard = (q) => guardQuery(q, sandbox.config.guardMode);
r.context.parseMultiLabel = parseMultiLabel;
r.context.joinMultiLabel = joinMultiLabel;

r.on("exit", async () => {
  await sandbox.close();
  process.exit(0);
});
