import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "..", "scripts");
const COMPOSE_FILE = join(SCRIPTS_DIR, "docker-compose.yml");

export interface SandboxOptions {
  port?: number;
  container?: string;
  image?: string;
}

function buildEnv(opts?: SandboxOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts?.port) env.NEPTUNE_TINKER_PORT = String(opts.port);
  if (opts?.container) env.NEPTUNE_TINKER_CONTAINER = opts.container;
  if (opts?.image) env.NEPTUNE_TINKER_IMAGE = opts.image;
  return env;
}

function compose(args: string, opts?: SandboxOptions): string {
  const cmd = `docker compose -f "${COMPOSE_FILE}" ${args}`;
  return execSync(cmd, {
    env: buildEnv(opts),
    stdio: "pipe",
    encoding: "utf-8",
  });
}

export function startSandbox(opts?: SandboxOptions): string {
  return compose("up -d --wait", opts);
}

export function stopSandbox(opts?: SandboxOptions): string {
  return compose("down", opts);
}

export function resetSandbox(opts?: SandboxOptions): string {
  compose("down", opts);
  return compose("up -d --wait", opts);
}

export function sandboxHealth(opts?: SandboxOptions): string {
  return compose("ps", opts);
}

export function sandboxLogs(opts?: SandboxOptions): void {
  const cmd = `docker compose -f "${COMPOSE_FILE}" logs -f`;
  execSync(cmd, {
    env: buildEnv(opts),
    stdio: "inherit",
    encoding: "utf-8",
  });
}

/** Resolved path to the scripts directory (for advanced use). */
export const SCRIPTS_PATH = SCRIPTS_DIR;

/** Resolved path to the docker-compose.yml file. */
export const COMPOSE_PATH = COMPOSE_FILE;
