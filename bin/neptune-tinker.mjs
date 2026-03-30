#!/usr/bin/env node

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const command = args[0];

import { createServer } from "node:net";

// Parse flags
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? args[portIdx + 1] : undefined;
const nameIdx = args.indexOf("--name");
const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
const noPersist = args.includes("--no-persist");

// When --name is used without --port, find a free port to avoid collisions
function findFreePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

const resolvedPort = port || (name ? String(await findFreePort()) : undefined);

const env = { ...process.env };
if (resolvedPort) env.NEPTUNE_TINKER_PORT = resolvedPort;
if (name) env.NEPTUNE_TINKER_CONTAINER = name;
if (noPersist) env.NEPTUNE_TINKER_PERSIST = "false";

const composefile = join(root, "scripts", "docker-compose.yml");
const projectName = name ? `-p ${name}` : "";
const compose = (cmd) => `docker compose ${projectName} -f "${composefile}" ${cmd}`;

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", env, ...opts });
}

async function importCmd() {
  const file = args[1];
  if (!file) {
    console.error("Usage: neptune-tinker import <file.json>");
    process.exit(1);
  }

  const { NeptuneSandbox } = await import(join(root, "dist", "index.js"));
  const { importFile } = await import(join(root, "dist", "import.js"));

  const sandbox = new NeptuneSandbox({ port: port ? Number(port) : undefined });
  await sandbox.connect();

  try {
    const result = await importFile(sandbox, file);
    console.log(`Done: ${result.vertices} vertices, ${result.edges} edges`);
  } finally {
    await sandbox.close();
  }
}

async function runCmd() {
  const query = args.slice(1).join(" ");
  if (!query) {
    console.error('Usage: neptune-tinker run \'g.V().count()\'');
    process.exit(1);
  }

  const gremlin = (await import("gremlin")).default;
  const p = resolvedPort || "8182";
  const client = new gremlin.driver.Client(`ws://localhost:${p}/gremlin`, {});
  try {
    const result = await client.submit(query);
    const items = result.toArray();
    for (const item of items) console.log(JSON.stringify(item, null, 2));
    if (items.length === 0) console.log("(empty)");
  } finally {
    await client.close();
  }
}

const commands = {
  start: () => {
    run(compose("up -d --wait"));
    if (name) console.log(`Neptune sandbox "${name}" ready at ws://localhost:${resolvedPort}/gremlin`);
  },
  stop: () => run(compose("down")),
  reset: () => { run(compose("down -v")); run(compose("up -d --wait")); },
  health: () => run(compose("ps")),
  logs: () => run(compose("logs -f")),
  console: () => run(compose("run --rm gremlin-console")),
  repl: () => run(`node "${join(root, "scripts", "repl.mjs")}"`),
  import: () => importCmd(),
  run: () => runCmd(),
};

if (!command || !commands[command]) {
  console.log(`Usage: neptune-tinker <command> [options]

Commands:
  start     Start the Gremlin Server sandbox
  stop      Stop the sandbox
  reset     Reset the sandbox (stop + start, clears all data)
  health    Show sandbox container status
  logs      Tail sandbox logs
  console   Open Gremlin Console (raw Gremlin, auto-connected)
  repl      Open Node.js REPL with middleware loaded
  import    Import data from JSON file: neptune-tinker import <file.json>
  run       Execute a Gremlin query: neptune-tinker run 'g.V().count()'

Options:
  --port <port>    Use a custom port (default: 8182)
  --name <name>    Isolated sandbox instance name (separate container + volume)
  --no-persist     In-memory only, no data persistence (faster)`);
  process.exit(command ? 1 : 0);
}

commands[command]();
