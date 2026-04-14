import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gremlin from "gremlin";
import { isDockerAvailable } from "./helpers.js";

const { driver, process: gprocess } = gremlin;
const { t, statics } = gprocess;

const dockerAvailable = await isDockerAvailable();

/**
 * Tests Neptune's multi-label append behavior:
 *   addV('NewLabel').property(T.id, 'existing-id')
 * appends 'NewLabel' to the existing vertex's labels instead of throwing.
 *
 * Uses a RAW gremlin connection — NO NeptuneSandbox JS middleware.
 * This validates the server-side strategy works for all clients.
 */
describe.skipIf(!dockerAvailable)("server-side multi-label append via addV + existing ID", () => {
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

  // ===========================================================================
  // Basic label append
  // ===========================================================================

  describe("basic label append", () => {
    it("appends a new label to an existing vertex", async () => {
      await g.addV("Person").property(t.id, "v1").property("name", "Alice").next();

      // In Neptune, this appends "Employee" to v1's labels
      await g.addV("Employee").property(t.id, "v1").next();

      // Vertex should now have label "Person::Employee"
      // hasLabel("Person") should match
      const byPerson = await g.V().hasLabel("Person").id().toList();
      expect(byPerson).toContain("v1");

      // hasLabel("Employee") should match
      const byEmployee = await g.V().hasLabel("Employee").id().toList();
      expect(byEmployee).toContain("v1");

      // Should still be exactly one vertex
      const count = await g.V("v1").count().next();
      expect(count.value).toBe(1);
    });

    it("is idempotent — appending an existing label is a no-op", async () => {
      await g.addV("Person").property(t.id, "v1").next();

      // Append "Person" again — should not duplicate
      await g.addV("Person").property(t.id, "v1").next();

      const labels = await g.V("v1").label().toList();
      expect(labels).toEqual(["Person"]);
    });

    it("appends to a multi-label vertex", async () => {
      await g.addV("Person::Employee").property(t.id, "v1").next();

      // Append a third label
      await g.addV("Manager").property(t.id, "v1").next();

      const byManager = await g.V().hasLabel("Manager").id().toList();
      expect(byManager).toContain("v1");

      const byPerson = await g.V().hasLabel("Person").id().toList();
      expect(byPerson).toContain("v1");

      const byEmployee = await g.V().hasLabel("Employee").id().toList();
      expect(byEmployee).toContain("v1");
    });

    it("appends compound labels (A::B)", async () => {
      await g.addV("Person").property(t.id, "v1").next();

      // Append "Employee::Manager" — both components added
      await g.addV("Employee::Manager").property(t.id, "v1").next();

      const byPerson = await g.V().hasLabel("Person").id().toList();
      expect(byPerson).toContain("v1");

      const byEmployee = await g.V().hasLabel("Employee").id().toList();
      expect(byEmployee).toContain("v1");

      const byManager = await g.V().hasLabel("Manager").id().toList();
      expect(byManager).toContain("v1");
    });

    it("deduplicates when compound label overlaps existing", async () => {
      await g.addV("Person::Employee").property(t.id, "v1").next();

      // "Employee::Manager" — Employee already present, only Manager is new
      await g.addV("Employee::Manager").property(t.id, "v1").next();

      // Should be Person::Employee::Manager (no duplicate Employee)
      const labels = await g.V("v1").label().toList();
      const parts = (labels[0] as string).split("::");
      expect(parts.filter((p: string) => p === "Employee").length).toBe(1);
      expect(parts).toContain("Person");
      expect(parts).toContain("Manager");
    });
  });

  // ===========================================================================
  // Property preservation
  // ===========================================================================

  describe("property preservation on label append", () => {
    it("preserves existing properties", async () => {
      await g.addV("Person").property(t.id, "v1")
        .property("name", "Alice")
        .property("age", 30)
        .next();

      await g.addV("Employee").property(t.id, "v1").next();

      const name = await g.V("v1").values("name").toList();
      expect(name).toContain("Alice");

      const age = await g.V("v1").values("age").toList();
      expect(age).toContain(30);
    });

    it("merges new properties from the append traversal", async () => {
      await g.addV("Person").property(t.id, "v1")
        .property("name", "Alice")
        .next();

      await g.addV("Employee").property(t.id, "v1")
        .property("department", "Engineering")
        .next();

      const name = await g.V("v1").values("name").toList();
      expect(name).toContain("Alice");

      const dept = await g.V("v1").values("department").toList();
      expect(dept).toContain("Engineering");
    });

    it("preserves set-cardinality multi-valued properties", async () => {
      await g.addV("Person").property(t.id, "v1")
        .property("tag", "a")
        .property("tag", "b")
        .next();

      await g.addV("Employee").property(t.id, "v1").next();

      const tags = await g.V("v1").values("tag").toList();
      expect((tags as string[]).sort()).toEqual(["a", "b"]);
    });
  });

  // ===========================================================================
  // Edge preservation
  // ===========================================================================

  describe("edge preservation on label append", () => {
    it("preserves outgoing edges", async () => {
      await g.addV("Person").property(t.id, "v1").property("name", "Alice").next();
      await g.addV("Company").property(t.id, "v2").property("name", "Acme").next();
      await g.addE("WORKS_AT").from_(statics.V("v1")).to(statics.V("v2")).next();

      // Append label to v1
      await g.addV("Employee").property(t.id, "v1").next();

      // Edge should still exist
      const companies = await g.V("v1").out("WORKS_AT").values("name").toList();
      expect(companies).toEqual(["Acme"]);
    });

    it("preserves incoming edges", async () => {
      await g.addV("Person").property(t.id, "v1").property("name", "Alice").next();
      await g.addV("Company").property(t.id, "v2").property("name", "Acme").next();
      await g.addE("EMPLOYS").from_(statics.V("v2")).to(statics.V("v1")).next();

      // Append label to v1
      await g.addV("Employee").property(t.id, "v1").next();

      // Incoming edge should still exist
      const employers = await g.V("v1").in_("EMPLOYS").values("name").toList();
      expect(employers).toEqual(["Acme"]);
    });

    it("preserves edge properties", async () => {
      await g.addV("Person").property(t.id, "v1").next();
      await g.addV("Company").property(t.id, "v2").next();
      await g.addE("WORKS_AT").from_(statics.V("v1")).to(statics.V("v2"))
        .property("since", 2020)
        .property("role", "Engineer")
        .next();

      await g.addV("Employee").property(t.id, "v1").next();

      const since = await g.V("v1").outE("WORKS_AT").values("since").toList();
      expect(since).toEqual([2020]);

      const role = await g.V("v1").outE("WORKS_AT").values("role").toList();
      expect(role).toEqual(["Engineer"]);
    });

    it("preserves self-loop edges", async () => {
      await g.addV("Node").property(t.id, "v1").next();
      await g.addE("LINKS_TO").from_(statics.V("v1")).to(statics.V("v1"))
        .property("weight", 1)
        .next();

      await g.addV("Important").property(t.id, "v1").next();

      // Self-loop should still exist
      const selfLoop = await g.V("v1").out("LINKS_TO").id().toList();
      expect(selfLoop).toEqual(["v1"]);

      const weight = await g.V("v1").outE("LINKS_TO").values("weight").toList();
      expect(weight).toEqual([1]);
    });

    it("preserves multiple edges in both directions", async () => {
      await g.addV("Person").property(t.id, "v1").next();
      await g.addV("Person").property(t.id, "v2").next();
      await g.addV("Company").property(t.id, "v3").next();

      await g.addE("KNOWS").from_(statics.V("v1")).to(statics.V("v2")).next();
      await g.addE("WORKS_AT").from_(statics.V("v1")).to(statics.V("v3")).next();
      await g.addE("MANAGES").from_(statics.V("v2")).to(statics.V("v1")).next();

      await g.addV("Employee").property(t.id, "v1").next();

      // Outgoing edges
      const outCount = await g.V("v1").outE().count().next();
      expect(outCount.value).toBe(2);

      // Incoming edges
      const inCount = await g.V("v1").inE().count().next();
      expect(inCount.value).toBe(1);

      // Specific traversals
      const knows = await g.V("v1").out("KNOWS").id().toList();
      expect(knows).toEqual(["v2"]);

      const managedBy = await g.V("v1").in_("MANAGES").id().toList();
      expect(managedBy).toEqual(["v2"]);
    });
  });

  // ===========================================================================
  // Normal creation still works
  // ===========================================================================

  describe("non-append cases remain unaffected", () => {
    it("addV with new T.id creates a fresh vertex", async () => {
      await g.addV("Person").property(t.id, "new-1").property("name", "Bob").next();

      const count = await g.V("new-1").count().next();
      expect(count.value).toBe(1);

      const name = await g.V("new-1").values("name").toList();
      expect(name).toEqual(["Bob"]);
    });

    it("addV without T.id still gets auto-generated UUID", async () => {
      await g.addV("Person").property("name", "Charlie").next();

      const ids = await g.V().hasLabel("Person").id().toList();
      expect(ids.length).toBe(1);

      // Should be a UUID string, not a numeric Long
      const id = ids[0] as string;
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(8);
    });
  });

  // ===========================================================================
  // hasLabel works correctly after append
  // ===========================================================================

  describe("hasLabel queries after label append", () => {
    beforeEach(async () => {
      // Create vertex, then append a label
      await g.addV("tenant-a::Finding").property(t.id, "f1").property("severity", "HIGH").next();
      await g.addV("Critical").property(t.id, "f1").next();
    });

    it("original components still match", async () => {
      const byTenant = await g.V().hasLabel("tenant-a").id().toList();
      expect(byTenant).toContain("f1");

      const byFinding = await g.V().hasLabel("Finding").id().toList();
      expect(byFinding).toContain("f1");
    });

    it("newly appended component matches", async () => {
      const byCritical = await g.V().hasLabel("Critical").id().toList();
      expect(byCritical).toContain("f1");
    });

    it("chained hasLabel scoping works after append", async () => {
      const result = await g.V()
        .hasLabel("tenant-a")
        .hasLabel("Critical")
        .values("severity")
        .toList();
      expect(result).toEqual(["HIGH"]);
    });
  });
});
