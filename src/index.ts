import gremlin from "gremlin";
import type { NeptuneTinkerConfig, ResolvedConfig } from "./types.js";
import { resolveConfig, NEPTUNE_UNSUPPORTED } from "./types.js";
import { guardQuery, lintQuery } from "./guard.js";

const { driver, process: gprocess } = gremlin;
const { DriverRemoteConnection } = driver;

type GremlinConnection = import("gremlin").driver.DriverRemoteConnection;
type GremlinTraversalSource = import("gremlin").process.GraphTraversalSource;

export class NeptuneSandbox {
  readonly config: ResolvedConfig;
  private connection: GremlinConnection | null = null;
  private _g: GremlinTraversalSource | null = null;

  constructor(config: NeptuneTinkerConfig = {}) {
    this.config = resolveConfig(config);
  }

  /**
   * Connect to the Gremlin Server and return the traversal source.
   * Neptune semantics (multi-label, set cardinality, UUID IDs) are handled
   * server-side — the returned `g` works identically to a Neptune connection.
   */
  async connect(): Promise<GremlinTraversalSource> {
    this.connection = new DriverRemoteConnection(this.config.endpoint);
    this._g = gprocess.traversal().withRemote(this.connection);
    return this._g;
  }

  /** Get the traversal source (must call connect() first). */
  get g(): GremlinTraversalSource {
    if (!this._g) throw new Error("Not connected. Call connect() first.");
    return this._g;
  }

  /** Close the connection. */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this._g = null;
    }
  }

  // -------------------------------------------------------------------
  // Guard / Lint
  // -------------------------------------------------------------------

  /** Lint a Gremlin query string for Neptune compatibility issues. */
  lint(query: string) {
    return lintQuery(query, this.config.guardMode);
  }

  /** Guard a query — throws in strict mode, warns in loose. */
  guard(query: string) {
    return guardQuery(query, this.config.guardMode);
  }

  // -------------------------------------------------------------------
  // Convenience: submit raw Gremlin string (with guard)
  // -------------------------------------------------------------------

  /**
   * Submit a raw Gremlin string to the server.
   * Runs the guard first, then submits via the connection.
   */
  async submit(query: string): Promise<unknown> {
    this.guard(query);

    if (!this.connection) throw new Error("Not connected. Call connect() first.");

    const client = new driver.Client(this.config.endpoint, {});
    try {
      const result = await client.submit(query);
      return result.toArray();
    } finally {
      await client.close();
    }
  }
}

// Re-exports
export { lintQuery, guardQuery, NeptuneCompatError } from "./guard.js";
export {
  parseMultiLabel,
  joinMultiLabel,
  delimiterHasLabel,
  LABEL_DELIM,
} from "./multilabel.js";
export type { NeptuneTinkerConfig, ResolvedConfig, GuardMode } from "./types.js";
export type { GuardViolation } from "./guard.js";
export { resolveConfig, resolveEndpoint, NEPTUNE_UNSUPPORTED, DEFAULT_HOST, DEFAULT_PORT } from "./types.js";
export {
  startSandbox,
  stopSandbox,
  resetSandbox,
  sandboxHealth,
  sandboxLogs,
  SCRIPTS_PATH,
  COMPOSE_PATH,
} from "./sandbox.js";
export type { SandboxOptions } from "./sandbox.js";
export { importData, importFile } from "./import.js";
export type { ImportData, ImportVertex, ImportEdge, ImportOptions } from "./import.js";
