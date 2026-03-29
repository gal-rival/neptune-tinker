import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gremlin from "gremlin";
import { isDockerAvailable } from "./helpers.js";

const { driver, process: gprocess } = gremlin;
const { t, P } = gprocess;

const dockerAvailable = await isDockerAvailable();

/**
 * Tests the server-side NeptuneMultiLabelStrategy (Groovy).
 * Uses a RAW gremlin connection — NO NeptuneSandbox JS middleware.
 * This validates that Python/Java/any client gets multi-label matching.
 */
describe.skipIf(!dockerAvailable)("server-side multi-label strategy (no JS middleware)", () => {
  let conn: InstanceType<typeof driver.DriverRemoteConnection>;
  let g: InstanceType<typeof gprocess.GraphTraversalSource>;

  beforeAll(async () => {
    conn = new driver.DriverRemoteConnection("ws://localhost:8182/gremlin");
    g = gprocess.traversal().withRemote(conn);
  });

  afterAll(async () => {
    if (conn) {
      try { await g.V().drop().toList(); } catch {}
      await conn.close();
    }
  });

  beforeEach(async () => {
    await g.V().drop().toList();
  });

  // =========================================================================
  // hasLabel with single component
  // =========================================================================

  describe("hasLabel() single component matching", () => {
    beforeEach(async () => {
      await g.addV("org-1::Finding").property(t.id, "f1").property("name", "vuln-1").next();
      await g.addV("org-1::CodeRepository").property(t.id, "r1").property("name", "repo-1").next();
      await g.addV("org-2::Finding").property(t.id, "f2").property("name", "vuln-2").next();
      await g.addV("SingleLabel").property(t.id, "s1").property("name", "solo").next();
    });

    it("matches first component of multi-label", async () => {
      const results = await g.V().hasLabel("org-1").count().next();
      expect(results.value).toBe(2);
    });

    it("matches second component of multi-label", async () => {
      const results = await g.V().hasLabel("Finding").values("name").toList();
      expect(results.sort()).toEqual(["vuln-1", "vuln-2"]);
    });

    it("matches exact single-label vertex", async () => {
      const results = await g.V().hasLabel("SingleLabel").values("name").toList();
      expect(results).toEqual(["solo"]);
    });

    it("returns empty for non-existent label", async () => {
      const results = await g.V().hasLabel("NonExistent").toList();
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // hasLabel("A::B") — compound labels never match (Neptune behavior)
  // =========================================================================

  describe("hasLabel() with :: compound label", () => {
    beforeEach(async () => {
      await g.addV("org-1::Finding").property(t.id, "f1").next();
    });

    it("hasLabel('org-1::Finding') returns empty", async () => {
      const results = await g.V().hasLabel("org-1::Finding").toList();
      expect(results).toEqual([]);
    });

    it("hasLabel('org-1::') returns empty", async () => {
      const results = await g.V().hasLabel("org-1::").toList();
      expect(results).toEqual([]);
    });

    it("hasLabel('::Finding') returns empty", async () => {
      const results = await g.V().hasLabel("::Finding").toList();
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // Substring safety — no false matches
  // =========================================================================

  describe("substring safety", () => {
    beforeEach(async () => {
      await g.addV("Person::Employee").property(t.id, "v1").next();
      await g.addV("PersonAdmin::Manager").property(t.id, "v2").next();
      await g.addV("AdminAssistant::Manager").property(t.id, "v3").next();
    });

    it("hasLabel('Person') matches Person::Employee but not PersonAdmin::Manager", async () => {
      const ids = await g.V().hasLabel("Person").id().toList();
      expect(ids).toContain("v1");
      expect(ids).not.toContain("v2");
    });

    it("hasLabel('Admin') does NOT match AdminAssistant::Manager", async () => {
      const ids = await g.V().hasLabel("Admin").id().toList();
      expect(ids).toEqual([]);
    });

    it("hasLabel('Manager') matches both ::Manager vertices", async () => {
      const ids = await g.V().hasLabel("Manager").id().toList();
      expect(ids.sort()).toEqual(["v2", "v3"]);
    });

    it("hasLabel('Employee') matches only Person::Employee", async () => {
      const ids = await g.V().hasLabel("Employee").id().toList();
      expect(ids).toEqual(["v1"]);
    });
  });

  // =========================================================================
  // P.within() — multiple label matching
  // =========================================================================

  describe("hasLabel with P.within()", () => {
    beforeEach(async () => {
      await g.addV("org::Finding").property(t.id, "f1").next();
      await g.addV("org::CodeRepository").property(t.id, "r1").next();
      await g.addV("org::Container").property(t.id, "c1").next();
    });

    it("P.within matches multiple label components", async () => {
      const results = await g.V().hasLabel(P.within("Finding", "Container")).count().next();
      expect(results.value).toBe(2);
    });

    it("P.within with non-matching labels returns empty", async () => {
      const results = await g.V().hasLabel(P.within("VirtualMachine", "Edge")).toList();
      expect(results).toEqual([]);
    });

    it("P.within with org scoping", async () => {
      await g.addV("other-org::Finding").property(t.id, "f2").next();
      const results = await g.V().hasLabel(P.within("org")).count().next();
      expect(results.value).toBe(3); // only org::*, not other-org::*
    });
  });

  // =========================================================================
  // Multi-tenant SubgraphStrategy simulation
  // =========================================================================

  describe("multi-tenant scoping via hasLabel (SubgraphStrategy pattern)", () => {
    beforeEach(async () => {
      await g.addV("tenant-a::Finding").property(t.id, "a-f1").property("severity", "CRITICAL").next();
      await g.addV("tenant-a::Repository").property(t.id, "a-r1").property("name", "repo-a").next();
      await g.addV("tenant-b::Finding").property(t.id, "b-f1").property("severity", "LOW").next();
    });

    it("scopes to tenant-a only", async () => {
      const count = await g.V().hasLabel("tenant-a").count().next();
      expect(count.value).toBe(2);
    });

    it("scopes to tenant-b only", async () => {
      const count = await g.V().hasLabel("tenant-b").count().next();
      expect(count.value).toBe(1);
    });

    it("chaining hasLabel for tenant + type", async () => {
      // Simulate: get all Findings for tenant-a
      // In production: SubgraphStrategy scopes to tenant, then hasLabel("Finding")
      const results = await g.V().hasLabel("tenant-a").hasLabel("Finding").values("severity").toList();
      expect(results).toEqual(["CRITICAL"]);
    });
  });

  // =========================================================================
  // Triple labels (A::B::C)
  // =========================================================================

  describe("triple-label vertices", () => {
    beforeEach(async () => {
      await g.addV("org::Finding::Critical").property(t.id, "v1").next();
    });

    it("matches first component", async () => {
      expect((await g.V().hasLabel("org").count().next()).value).toBe(1);
    });

    it("matches middle component", async () => {
      expect((await g.V().hasLabel("Finding").count().next()).value).toBe(1);
    });

    it("matches last component", async () => {
      expect((await g.V().hasLabel("Critical").count().next()).value).toBe(1);
    });

    it("compound label does not match", async () => {
      expect((await g.V().hasLabel("org::Finding").count().next()).value).toBe(0);
    });
  });

  // =========================================================================
  // Edge traversals with hasLabel
  // =========================================================================

  describe("edge traversals with multi-label vertices", () => {
    beforeEach(async () => {
      await g.addV("org::Finding").property(t.id, "f1").property("severity", "HIGH").next();
      await g.addV("org::RepositoryBranch").property(t.id, "b1").property("ref", "main").next();
      await g.addE("FOUND_IN").from_(gprocess.statics.V("f1")).to(gprocess.statics.V("b1")).next();
    });

    it("in_().hasLabel() uses multi-label matching", async () => {
      const findings = await g.V("b1").in_("FOUND_IN").hasLabel("Finding").values("severity").toList();
      expect(findings).toEqual(["HIGH"]);
    });

    it("out().hasLabel() uses multi-label matching", async () => {
      const branches = await g.V("f1").out("FOUND_IN").hasLabel("RepositoryBranch").values("ref").toList();
      expect(branches).toEqual(["main"]);
    });
  });
});
