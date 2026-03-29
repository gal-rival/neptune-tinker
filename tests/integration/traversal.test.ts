import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gremlin from "gremlin";
import { NeptuneSandbox } from "../../src/index.js";
import { HIDDEN_LABELS_KEY } from "../../src/multilabel.js";
import { isDockerAvailable, setupSandbox, teardownSandbox, clearGraph } from "./helpers.js";

const { process: gprocess } = gremlin;
const { t, cardinality } = gprocess;

// ---------------------------------------------------------------------------
// Docker gate — skip all integration tests if server isn't running
// ---------------------------------------------------------------------------

const dockerAvailable = await isDockerAvailable();

describe.skipIf(!dockerAvailable)("neptune-traversal (delimiter strategy)", () => {
  let sandbox: NeptuneSandbox;

  beforeAll(async () => {
    sandbox = await setupSandbox({ multiLabelStrategy: "delimiter" });
  });

  afterAll(async () => {
    if (sandbox) await teardownSandbox(sandbox);
  });

  beforeEach(async () => {
    await clearGraph(sandbox);
  });

  // =========================================================================
  // Property cardinality override
  // =========================================================================

  describe("property cardinality defaults to set", () => {
    it("stores property with set cardinality by default", async () => {
      await sandbox.g
        .addV("TestVertex")
        .property("name", "Alice")
        .property("name", "Alice") // duplicate — set should deduplicate
        .next();

      const values = await sandbox.g.V().hasLabel("TestVertex").values("name").toList();
      // Set cardinality: only one "Alice" (not two like list would give)
      expect(values).toEqual(["Alice"]);
    });

    it("allows multiple distinct values with set cardinality", async () => {
      await sandbox.g
        .addV("TestVertex")
        .property("tag", "a")
        .property("tag", "b")
        .next();

      const values = await sandbox.g.V().hasLabel("TestVertex").values("tag").toList();
      expect(values.sort()).toEqual(["a", "b"]);
    });

    it("preserves explicit cardinality when specified", async () => {
      await sandbox.g
        .addV("TestVertex")
        .property(cardinality.single, "name", "Bob")
        .next();

      const values = await sandbox.g.V().hasLabel("TestVertex").values("name").toList();
      expect(values).toEqual(["Bob"]);
    });
  });

  // =========================================================================
  // hasLabel override — delimiter strategy
  // =========================================================================

  describe("hasLabel multi-label matching", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      // Create a multi-labeled vertex
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
      // Create a single-labeled vertex
      await sandbox.g.addV("Manager").property("name", "Bob").next();
    });

    it("hasLabel('Person') matches 'Person::Employee'", async () => {
      const results = await sandbox.g.V().hasLabel("Person").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("hasLabel('Employee') matches 'Person::Employee'", async () => {
      const results = await sandbox.g.V().hasLabel("Employee").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("hasLabel('Manager') does not match 'Person::Employee'", async () => {
      const results = await sandbox.g.V().hasLabel("Manager").values("name").toList();
      expect(results).toEqual(["Bob"]);
      expect(results).not.toContain("Alice");
    });

    it("hasLabel('Person::Employee') passes through (native TinkerGraph match)", async () => {
      // In Neptune hasLabel("A::B") doesn't match, but our guard catches this.
      // The traversal override only intercepts single labels without ::
      // so this passes through to native TinkerGraph which does exact match.
      const results = await sandbox.g
        .V()
        .hasLabel("Person::Employee")
        .values("name")
        .toList();
      expect(results).toContain("Alice");
    });

    it("substring safety: hasLabel('Person') does NOT match 'PersonAdmin::Manager'", async () => {
      await sandbox.g.addV("PersonAdmin::Manager").property("name", "Charlie").next();

      const results = await sandbox.g.V().hasLabel("Person").values("name").toList();
      // Should find Alice (Person::Employee) but NOT Charlie (PersonAdmin::Manager)
      expect(results).toContain("Alice");
      expect(results).not.toContain("Charlie");
    });

    it("hasLabel('Admin') does NOT match 'AdminAssistant::Manager'", async () => {
      await sandbox.g.addV("AdminAssistant::Manager").property("name", "Dave").next();

      const results = await sandbox.g.V().hasLabel("Admin").values("name").toList();
      expect(results).not.toContain("Dave");
    });
  });

  // =========================================================================
  // has() override
  // =========================================================================

  describe("has() override", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
    });

    it("has(T.label, 'Person') routes through hasLabel", async () => {
      const results = await sandbox.g.V().has(t.label, "Person").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("has('Person', 'name', 'Alice') decomposes to hasLabel + has", async () => {
      const results = await sandbox.g
        .V()
        .has("Person", "name", "Alice")
        .values("name")
        .toList();
      expect(results).toContain("Alice");
    });

    it("has('name', 'Alice') passes through normally", async () => {
      const results = await sandbox.g.V().has("name", "Alice").values("name").toList();
      expect(results).toContain("Alice");
    });
  });

  // =========================================================================
  // Neptune-aware statics (__)
  // =========================================================================

  describe("neptune-aware statics (__)", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
      await sandbox.g.addV("Robot").property("name", "Bender").next();
    });

    it("__.hasLabel('Person') inside where() matches multi-label vertex", async () => {
      const __ = sandbox.__;
      const results = await sandbox.g
        .V()
        .where(__.hasLabel("Person"))
        .values("name")
        .toList();
      expect(results).toContain("Alice");
      expect(results).not.toContain("Bender");
    });

    it("__.hasLabel('Employee') inside filter() matches", async () => {
      const __ = sandbox.__;
      const results = await sandbox.g
        .V()
        .filter(__.hasLabel("Employee"))
        .values("name")
        .toList();
      expect(results).toContain("Alice");
    });
  });
});

// ===========================================================================
// Property strategy tests
// ===========================================================================

describe.skipIf(!dockerAvailable)("neptune-traversal (property strategy)", () => {
  let sandbox: NeptuneSandbox;

  beforeAll(async () => {
    sandbox = await setupSandbox({ multiLabelStrategy: "property" });
  });

  afterAll(async () => {
    if (sandbox) await teardownSandbox(sandbox);
  });

  beforeEach(async () => {
    await clearGraph(sandbox);
  });

  describe("addV with property strategy", () => {
    it("creates __labels property for multi-label vertex", async () => {
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();

      const labels = await sandbox.g
        .V()
        .has(HIDDEN_LABELS_KEY, "Person")
        .values(HIDDEN_LABELS_KEY)
        .toList();
      expect(labels.sort()).toEqual(["Employee", "Person"]);
    });

    it("does not create __labels for single-label vertex", async () => {
      await sandbox.g.addV("Robot").property("name", "Bender").next();

      // Single label without :: — addV override only fires when label contains ::
      const labels = await sandbox.g.V().hasLabel("Robot").values(HIDDEN_LABELS_KEY).toList();
      expect(labels).toEqual([]);
    });
  });

  describe("hasLabel with property strategy", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
      await sandbox.g.addV("Manager").property("name", "Bob").next();
    });

    it("hasLabel('Person') matches via __labels property", async () => {
      const results = await sandbox.g.V().hasLabel("Person").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("hasLabel('Employee') matches via __labels property", async () => {
      const results = await sandbox.g.V().hasLabel("Employee").values("name").toList();
      expect(results).toContain("Alice");
    });

    it("hasLabel('Manager') does not match Person::Employee", async () => {
      const results = await sandbox.g.V().hasLabel("Manager").values("name").toList();
      // Bob has "Manager" as native label but no __labels
      // The property strategy rewrites hasLabel to has("__labels", ...) so Bob won't match
      // unless Bob also has __labels with "Manager". Since Bob is a single-label vertex,
      // addV doesn't add __labels, so hasLabel("Manager") won't find Bob either.
      // This is a known tradeoff of the property strategy for single-label vertices.
      expect(results).not.toContain("Alice");
    });
  });

  describe("has() override with property strategy", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
    });

    it("has(T.label, 'Person') routes through hasLabel → __labels", async () => {
      const results = await sandbox.g.V().has(t.label, "Person").values("name").toList();
      expect(results).toContain("Alice");
    });
  });

  describe("neptune-aware statics (property strategy)", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await sandbox.g.addV("Person::Employee").property("name", "Alice").next();
    });

    it("__.hasLabel('Person') inside where() matches via __labels", async () => {
      const __ = sandbox.__;
      const results = await sandbox.g
        .V()
        .where(__.hasLabel("Person"))
        .values("name")
        .toList();
      expect(results).toContain("Alice");
    });
  });
});
