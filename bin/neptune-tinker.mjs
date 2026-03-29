#!/usr/bin/env node

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const command = args[0];

// Parse --port flag
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? args[portIdx + 1] : undefined;

const env = { ...process.env };
if (port) env.NEPTUNE_TINKER_PORT = port;

const composefile = join(root, "scripts", "docker-compose.yml");
const compose = (cmd) => `docker compose -f "${composefile}" ${cmd}`;

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", env, ...opts });
}

const commands = {
  start: () => run(compose("up -d --wait")),
  stop: () => run(compose("down")),
  reset: () => { run(compose("down")); run(compose("up -d --wait")); },
  health: () => run(compose("ps")),
  logs: () => run(compose("logs -f")),
  console: () => run(compose("run --rm gremlin-console")),
  repl: () => run(`node "${join(root, "scripts", "repl.mjs")}"`),
};

if (!command || !commands[command]) {
  console.log(`Usage: neptune-tinker <command> [--port <port>]

Commands:
  start     Start the Gremlin Server sandbox
  stop      Stop the sandbox
  reset     Reset the sandbox (stop + start, clears data)
  health    Show sandbox container status
  logs      Tail sandbox logs
  console   Open Gremlin Console (raw Gremlin, auto-connected)
  repl      Open Node.js REPL with middleware loaded`);
  process.exit(command ? 1 : 0);
}

commands[command]();
