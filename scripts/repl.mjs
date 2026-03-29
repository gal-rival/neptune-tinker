import repl from "node:repl";
import { NeptuneSandbox, lintQuery, guardQuery, parseMultiLabel, joinMultiLabel } from "../dist/index.js";

const sandbox = new NeptuneSandbox();
await sandbox.connect();

console.log("\n  Neptune Sandbox REPL — middleware loaded\n");
console.log("  Globals:");
console.log("    sandbox   — NeptuneSandbox instance (connected)");
console.log("    g         — Gremlin traversal source");
console.log("    lint(q)   — lint a Gremlin string");
console.log("    guard(q)  — guard a Gremlin string (throws in strict)");
console.log("");
console.log("  Examples:");
console.log('    await sandbox.addV("Person::Employee", { name: "Alice" }, "a1")');
console.log('    await sandbox.V_byLabel("Person").toList()');
console.log('    await g.V().count().next()');
console.log('    lint("g.V(123)")');
console.log("");

const r = repl.start({ prompt: "neptune> ", useGlobal: true });

r.context.sandbox = sandbox;
r.context.g = sandbox.g;
r.context.lint = (q) => lintQuery(q, sandbox.config.guardMode);
r.context.guard = (q) => guardQuery(q, sandbox.config.guardMode);
r.context.parseMultiLabel = parseMultiLabel;
r.context.joinMultiLabel = joinMultiLabel;

r.on("exit", async () => {
  await sandbox.close();
  process.exit(0);
});
