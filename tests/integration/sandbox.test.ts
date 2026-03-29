import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gremlin from "gremlin";
import { NeptuneSandbox } from "../../src/index.js";
import { NeptuneCompatError } from "../../src/guard.js";
import { isDockerAvailable, clearGraph } from "./helpers.js";

const { process: gprocess } = gremlin;
const { t } = gprocess;

const dockerAvailable = await isDockerAvailable();

// ===========================================================================
// NeptuneSandbox lifecycle (no Docker needed for some)
// ===========================================================================

describe("NeptuneSandbox (no Docker)", () => {
  describe("constructor", () => {
    it("resolves config with defaults", () => {
      const sandbox = new NeptuneSandbox();
      expect(sandbox.config.host).toBe("localhost");
      expect(sandbox.config.port).toBe(8182);
      expect(sandbox.config.guardMode).toBe("strict");
    });

    it("accepts custom config", () => {
      const sandbox = new NeptuneSandbox({
        port: 9999,
        guardMode: "loose",
      });
      expect(sandbox.config.port).toBe(9999);
      expect(sandbox.config.guardMode).toBe("loose");
    });
  });

  describe("g getter before connect", () => {
    it("throws if not connected", () => {
      const sandbox = new NeptuneSandbox();
      expect(() => sandbox.g).toThrow("Not connected");
    });
  });

  describe("lint()", () => {
    it("returns violations for bad query (strict mode)", () => {
      const sandbox = new NeptuneSandbox({ guardMode: "strict" });
      const violations = sandbox.lint(`g.V(123)`);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].rule).toBe("string-ids-only");
      expect(violations[0].severity).toBe("error");
    });

    it("returns violations for bad query (loose mode)", () => {
      const sandbox = new NeptuneSandbox({ guardMode: "loose" });
      const violations = sandbox.lint(`g.V(123)`);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe("warning");
    });

    it("returns empty array for clean query", () => {
      const sandbox = new NeptuneSandbox();
      expect(sandbox.lint(`g.V().hasLabel("Person")`)).toEqual([]);
    });
  });

  describe("guard()", () => {
    it("throws NeptuneCompatError in strict mode", () => {
      const sandbox = new NeptuneSandbox({ guardMode: "strict" });
      expect(() => sandbox.guard(`g.V(123)`)).toThrow(NeptuneCompatError);
    });

    it("does not throw in loose mode", () => {
      const sandbox = new NeptuneSandbox({ guardMode: "loose" });
      expect(() => sandbox.guard(`g.V(123)`)).not.toThrow();
    });

    it("does not throw for clean query in strict mode", () => {
      const sandbox = new NeptuneSandbox({ guardMode: "strict" });
      expect(() => sandbox.guard(`g.V().count()`)).not.toThrow();
    });
  });
});

// ===========================================================================
// NeptuneSandbox with Docker — all Neptune semantics are server-side
// ===========================================================================

describe.skipIf(!dockerAvailable)("NeptuneSandbox (with Docker)", () => {
  let sandbox: NeptuneSandbox;
  let g: ReturnType<typeof sandbox.g>;

  beforeAll(async () => {
    sandbox = new NeptuneSandbox();
    await sandbox.connect();
    g = sandbox.g;
  });

  afterAll(async () => {
    if (sandbox) {
      try {
        await g.V().drop().toList();
      } catch {
        // ignore
      }
      await sandbox.close();
    }
  });

  beforeEach(async () => {
    await clearGraph(sandbox);
  });

  describe("connect() / close() lifecycle", () => {
    it("g is accessible after connect", () => {
      expect(() => sandbox.g).not.toThrow();
    });

    it("can reconnect after close", async () => {
      const fresh = new NeptuneSandbox();
      await fresh.connect();
      expect(() => fresh.g).not.toThrow();
      await fresh.close();
    });
  });

  describe("server-side UUID auto-generation", () => {
    it("auto-generates UUID when no ID given", async () => {
      await g.addV("Person").property("name", "Alice").next();

      const ids = await g.V().hasLabel("Person").id().toList();
      expect(ids.length).toBe(1);
      expect(String(ids[0])).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("explicit ID overrides auto-generation", async () => {
      await g.addV("Person").property(t.id, "custom-id-1").property("name", "Bob").next();

      const results = await g.V("custom-id-1").values("name").toList();
      expect(results).toEqual(["Bob"]);
    });
  });

  describe("server-side set cardinality", () => {
    it("deduplicates property values", async () => {
      await g.addV("Person").property(t.id, "p1").property("name", "Alice").next();
      await g.V("p1").property("name", "Alice").next();

      const values = await g.V("p1").values("name").toList();
      expect(values).toEqual(["Alice"]);
    });
  });

  describe("server-side multi-label matching", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await g.addV("Person::Employee").property(t.id, "a1").property("name", "Alice").next();
      await g.addV("Person::Manager").property(t.id, "b1").property("name", "Bob").next();
      await g.addV("Robot").property(t.id, "c1").property("name", "Bender").next();
    });

    it("finds vertices matching a single label component", async () => {
      const results = await g.V().hasLabel("Person").values("name").toList();
      expect(results.sort()).toEqual(["Alice", "Bob"]);
    });

    it("finds vertices matching second label component", async () => {
      const results = await g.V().hasLabel("Employee").values("name").toList();
      expect(results).toEqual(["Alice"]);
    });

    it("does not match non-existent label", async () => {
      const results = await g.V().hasLabel("NonExistent").values("name").toList();
      expect(results).toEqual([]);
    });

    it("handles single-label vertices", async () => {
      const results = await g.V().hasLabel("Robot").values("name").toList();
      expect(results).toEqual(["Bender"]);
    });
  });

  describe("submit()", () => {
    it("runs guard before executing", async () => {
      await expect(sandbox.submit(`g.V(123)`)).rejects.toThrow(NeptuneCompatError);
    });

    it("executes valid queries", async () => {
      await g.addV("Person").property(t.id, "p1").property("name", "Alice").next();
      const result = await sandbox.submit(`g.V().hasLabel("Person").count()`);
      expect(result).toBeDefined();
    });
  });
});
