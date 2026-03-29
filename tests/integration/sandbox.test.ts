import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NeptuneSandbox } from "../../src/index.js";
import { NeptuneCompatError } from "../../src/guard.js";
import { isDockerAvailable, clearGraph } from "./helpers.js";

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

  describe("__ getter before connect", () => {
    it("throws if not connected", () => {
      const sandbox = new NeptuneSandbox();
      expect(() => sandbox.__).toThrow("Not connected");
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
// NeptuneSandbox with Docker
// ===========================================================================

describe.skipIf(!dockerAvailable)("NeptuneSandbox (with Docker)", () => {
  let sandbox: NeptuneSandbox;

  beforeAll(async () => {
    sandbox = new NeptuneSandbox();
    await sandbox.connect();
  });

  afterAll(async () => {
    if (sandbox) {
      try {
        await sandbox.g.V().drop().toList();
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

    it("__ is accessible after connect", () => {
      expect(() => sandbox.__).not.toThrow();
    });

    it("can reconnect after close", async () => {
      const fresh = new NeptuneSandbox();
      await fresh.connect();
      expect(() => fresh.g).not.toThrow();
      await fresh.close();
    });
  });

  describe("addV() helper", () => {
    it("creates a vertex findable by label component", async () => {
      await sandbox.addV("Person::Employee", { name: "Alice" });

      const results = await sandbox.g.V().hasLabel("Person").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("creates a vertex with custom ID", async () => {
      await sandbox.addV("Person", { name: "Bob" }, "custom-id-1");

      const results = await sandbox.g.V("custom-id-1").values("name").toList();
      expect(results).toEqual(["Bob"]);
    });

    it("creates a vertex with auto-generated UUID when no ID given", async () => {
      await sandbox.addV("Person", { name: "Charlie" });

      const ids = await sandbox.g.V().hasLabel("Person").id().toList();
      expect(ids.length).toBe(1);
      // UUID format: 8-4-4-4-12 hex chars
      expect(String(ids[0])).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("stores properties with set cardinality", async () => {
      await sandbox.addV("Person", { name: "Alice" });
      // Add same property again via raw traversal
      await sandbox.g.V().hasLabel("Person").property("name", "Alice").next();

      const values = await sandbox.g.V().hasLabel("Person").values("name").toList();
      // Set cardinality: should have only one "Alice"
      expect(values).toEqual(["Alice"]);
    });
  });

  describe("hasLabel() multi-label matching via g", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.addV("Person::Employee", { name: "Alice" });
      await sandbox.addV("Person::Manager", { name: "Bob" });
      await sandbox.addV("Robot", { name: "Bender" });
    });

    it("finds vertices matching a single label component", async () => {
      const results = await sandbox.g.V().hasLabel("Person").values("name").toList();
      expect(results.sort()).toEqual(["Alice", "Bob"]);
    });

    it("finds vertices matching second label component", async () => {
      const results = await sandbox.g.V().hasLabel("Employee").values("name").toList();
      expect(results).toEqual(["Alice"]);
    });

    it("does not match non-existent label", async () => {
      const results = await sandbox.g.V().hasLabel("NonExistent").values("name").toList();
      expect(results).toEqual([]);
    });

    it("handles single-label vertices", async () => {
      const results = await sandbox.g.V().hasLabel("Robot").values("name").toList();
      expect(results).toEqual(["Bender"]);
    });
  });

  describe("submit()", () => {
    it("runs guard before executing", async () => {
      // strict mode: numeric ID should throw
      await expect(sandbox.submit(`g.V(123)`)).rejects.toThrow(NeptuneCompatError);
    });

    it("executes valid queries", async () => {
      await sandbox.addV("Person", { name: "Alice" });
      const result = await sandbox.submit(`g.V().hasLabel("Person").count()`);
      expect(result).toBeDefined();
    });
  });
});
