import { randomUUID } from "node:crypto";
import gremlin from "gremlin";
import type { NeptuneTinkerConfig, ResolvedConfig } from "./types.js";
import { resolveConfig, NEPTUNE_UNSUPPORTED } from "./types.js";
import { guardQuery, lintQuery } from "./guard.js";
import { parseMultiLabel, HIDDEN_LABELS_KEY, LABEL_DELIM } from "./multilabel.js";
import { createNeptuneTraversal } from "./neptune-traversal.js";

const { driver, process: gprocess } = gremlin;
const { DriverRemoteConnection } = driver;

type GremlinConnection = import("gremlin").driver.DriverRemoteConnection;
type GremlinTraversalSource = import("gremlin").process.GraphTraversalSource;
type GremlinTraversal = import("gremlin").process.GraphTraversal;

export class NeptuneSandbox {
  readonly config: ResolvedConfig;
  private connection: GremlinConnection | null = null;
  private _g: GremlinTraversalSource | null = null;
  private _statics: Record<string, (...args: unknown[]) => unknown> | null = null;

  constructor(config: NeptuneTinkerConfig = {}) {
    this.config = resolveConfig(config);
  }

  /** Connect to the Gremlin Server and return the traversal source.
   *  The returned `g` transparently handles Neptune semantics:
   *  - Multi-label emulation (addV, hasLabel)
   *  - Default set cardinality for properties
   */
  async connect(): Promise<GremlinTraversalSource> {
    this.connection = new DriverRemoteConnection(this.config.endpoint);
    const { Source, Traversal, statics } = createNeptuneTraversal({
      multiLabelStrategy: this.config.multiLabelStrategy,
    });
    this._g = gprocess.traversal(Source, Traversal).withRemote(this.connection);
    this._statics = statics;
    return this._g;
  }

  /** Get the traversal source (must call connect() first). */
  get g(): GremlinTraversalSource {
    if (!this._g) throw new Error("Not connected. Call connect() first.");
    return this._g;
  }

  /**
   * Neptune-aware anonymous traversal helpers.
   * Use `sandbox.__` instead of `gprocess.statics` / `__` so that
   * hasLabel(), has(), property() inside where()/filter()/not()
   * use multi-label matching and set cardinality.
   *
   * Example:
   *   const __ = sandbox.__;
   *   g.V().where(__.hasLabel("Person")).toList()
   */
  get __(): Record<string, (...args: unknown[]) => unknown> {
    if (!this._statics) throw new Error("Not connected. Call connect() first.");
    return this._statics;
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
  // Multi-label helpers
  // -------------------------------------------------------------------

  /**
   * Add a vertex with Neptune-style multi-labels.
   *
   * Usage:
   *   await sandbox.addV("Person::Employee", { name: "Alice", age: 30 }, "custom-id-1")
   *
   * With "delimiter" strategy: stores label as "Person::Employee" natively.
   * With "property" strategy: stores label as "Person::Employee" AND writes
   *   __labels property with set cardinality for each component.
   */
  async addV(
    label: string,
    properties?: Record<string, unknown>,
    id?: string
  ) {
    const g = this.g;
    let t = g.addV(label);

    // Set vertex ID — explicit or auto-generated UUID (matching Neptune behavior)
    t = t.property(gprocess.t.id, id ?? randomUUID());

    // Multi-label __labels properties are handled by the NeptuneGraphTraversalSource
    // override (see neptune-traversal.ts). No need to add them here.

    // Write user properties (cardinality defaults handled by NeptuneGraphTraversal)
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        t = t.property(key, value);
      }
    }

    return t.next();
  }

  /**
   * Query vertices by a single label, respecting multi-label semantics.
   *
   * Usage:
   *   const people = await sandbox.V_byLabel("Person").toList()
   *
   * With "delimiter" strategy: returns a filtered traversal using a has() filter
   * on the native label containing the target label as a :: component.
   *
   * With "property" strategy: uses has("__labels", label).
   */
  V_byLabel(label: string) {
    const g = this.g;
    if (this.config.multiLabelStrategy === "property") {
      return g.V().has(HIDDEN_LABELS_KEY, label);
    }
    // Delimiter strategy: filter with a traversal that checks the native label
    // We use filter + label().is(containing(label)) but since Gremlin doesn't have
    // a native "contains substring" that respects :: boundaries, we use a workaround:
    // Vertices whose label is exactly `label` OR contains `::label::` or starts with `label::` or ends with `::label`
    const __ = gprocess.statics;
    return g.V().filter(
      __.or(
        __.label().is(gprocess.P.eq(label)),
        __.label().is(gprocess.TextP.startingWith(`${label}${LABEL_DELIM}`)),
        __.label().is(gprocess.TextP.endingWith(`${LABEL_DELIM}${label}`)),
        __.label().is(gprocess.TextP.containing(`${LABEL_DELIM}${label}${LABEL_DELIM}`)),
      )
    );
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
   *
   * Note: this uses the Gremlin client's script submission, not bytecode.
   * Useful for testing string-based queries as Neptune would receive them.
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
  rewriteHasLabel,
  HIDDEN_LABELS_KEY,
  LABEL_DELIM,
} from "./multilabel.js";
export type { NeptuneTinkerConfig, ResolvedConfig, GuardMode, MultiLabelStrategy } from "./types.js";
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
export { createNeptuneTraversal } from "./neptune-traversal.js";
export type { NeptuneTraversalConfig } from "./neptune-traversal.js";
