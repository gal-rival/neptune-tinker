import { createConnection, type Socket } from "node:net";
import { NeptuneSandbox } from "../../src/index.js";
import type { NeptuneTinkerConfig } from "../../src/types.js";

const DEFAULT_PORT = Number(process.env.NEPTUNE_TINKER_PORT) || 8182;
const DEFAULT_HOST = process.env.NEPTUNE_TINKER_HOST || "localhost";

/**
 * Check if the Gremlin Server is reachable via TCP.
 * Returns true if a connection succeeds within the timeout.
 */
export function isDockerAvailable(
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Create and connect a NeptuneSandbox instance.
 * Caller is responsible for calling teardownSandbox() after.
 */
export async function setupSandbox(
  config?: NeptuneTinkerConfig
): Promise<NeptuneSandbox> {
  const sandbox = new NeptuneSandbox({
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    ...config,
  });
  await sandbox.connect();
  return sandbox;
}

/**
 * Drop all vertices and edges, then close the connection.
 */
export async function teardownSandbox(sandbox: NeptuneSandbox): Promise<void> {
  try {
    await sandbox.g.V().drop().toList();
  } catch {
    // Graph may already be empty or connection may be lost — that's fine
  }
  await sandbox.close();
}

/**
 * Clear all graph data (useful between tests).
 */
export async function clearGraph(sandbox: NeptuneSandbox): Promise<void> {
  await sandbox.g.V().drop().toList();
}
