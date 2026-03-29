import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gremlin from "gremlin";
import { NeptuneSandbox } from "../../src/index.js";
import { isDockerAvailable, setupSandbox, teardownSandbox, clearGraph } from "./helpers.js";

const { process: gprocess } = gremlin;
const { t, cardinality, P, TextP, order: Order } = gprocess;

const dockerAvailable = await isDockerAvailable();

// ---------------------------------------------------------------------------
// Tests modeled after the real Gremlin patterns in rival/apps/etl-workflows/
// ---------------------------------------------------------------------------

const ORG = "test-org-001";
const label = (type: string) => `${ORG}::${type}`;

describe.skipIf(!dockerAvailable)("rival repo Gremlin patterns", () => {
  let sandbox: NeptuneSandbox;
  let g: ReturnType<typeof sandbox.g>;
  let __: ReturnType<typeof sandbox.__>;

  beforeAll(async () => {
    sandbox = await setupSandbox();
    g = sandbox.g;
    __ = sandbox.__;
  });

  afterAll(async () => {
    if (sandbox) await teardownSandbox(sandbox);
  });

  beforeEach(async () => {
    await clearGraph(sandbox);
  });

  // =========================================================================
  // Multi-tenant labels (org::Type pattern)
  // =========================================================================

  describe("multi-tenant labels", () => {
    it("creates vertex with org::Type label", async () => {
      await g.addV(label("Finding"))
        .property(t.id, "f-1")
        .property("severity", "CRITICAL")
        .next();

      const count = await g.V("f-1").count().next();
      expect(count.value).toBe(1);
    });

    it("hasLabel('Finding') matches org::Finding vertices", async () => {
      await g.addV(label("Finding")).property(t.id, "f-1").property("name", "vuln-1").next();
      await g.addV(label("CodeRepository")).property(t.id, "r-1").property("name", "repo-1").next();

      const findings = await g.V().hasLabel("Finding").values("name").toList();
      expect(findings).toEqual(["vuln-1"]);
    });

    it("hasLabel('test-org-001') matches all org vertices", async () => {
      await g.addV(label("Finding")).property(t.id, "f-1").next();
      await g.addV(label("CodeRepository")).property(t.id, "r-1").next();
      await g.addV("other-org::Finding").property(t.id, "f-2").next();

      const orgVertices = await g.V().hasLabel(ORG).toList();
      expect(orgVertices.length).toBe(2);
    });
  });

  // =========================================================================
  // Upsert pattern (coalesce)
  // =========================================================================

  describe("vertex upsert via coalesce", () => {
    it("creates vertex on first call", async () => {
      await g.V("f-1").fold()
        .coalesce(
          __.unfold(),
          __.addV(label("Finding")).property(t.id, "f-1"),
        )
        .property("severity", "HIGH")
        .next();

      const severity = await g.V("f-1").values("severity").toList();
      expect(severity).toEqual(["HIGH"]);
    });

    it("updates existing vertex on second call", async () => {
      // First upsert
      await g.V("f-1").fold()
        .coalesce(__.unfold(), __.addV(label("Finding")).property(t.id, "f-1"))
        .property("severity", "HIGH")
        .next();

      // Second upsert — same ID, different value
      await g.V("f-1").fold()
        .coalesce(__.unfold(), __.addV(label("Finding")).property(t.id, "f-1"))
        .property("severity", "CRITICAL")
        .next();

      const count = await g.V("f-1").count().next();
      expect(count.value).toBe(1);

      const severity = await g.V("f-1").values("severity").toList();
      expect(severity).toContain("CRITICAL");
    });
  });

  // =========================================================================
  // Edge creation
  // =========================================================================

  describe("edge creation", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await g.addV(label("CodeRepository")).property(t.id, "repo-1").property("name", "my-repo").next();
      await g.addV(label("RepositoryBranch")).property(t.id, "branch-1").property("ref", "main").next();
      await g.addV(label("Finding")).property(t.id, "f-1").property("severity", "HIGH").next();
    });

    it("creates edge with addE().from().to()", async () => {
      await g.addE("CONTAINS").from_(__.V("repo-1")).to(__.V("branch-1")).next();

      const branches = await g.V("repo-1").out("CONTAINS").values("ref").toList();
      expect(branches).toEqual(["main"]);
    });

    it("creates edge with coalesce (upsert pattern)", async () => {
      await g.V("branch-1")
        .coalesce(
          __.inE("FOUND_IN").where(__.outV().hasId("f-1")),
          __.addE("FOUND_IN").from_(__.V("f-1")),
        )
        .next();

      const found = await g.V("f-1").out("FOUND_IN").id().toList();
      expect(found).toContain("branch-1");
    });
  });

  // =========================================================================
  // Complex read queries
  // =========================================================================

  describe("complex read queries", () => {
    beforeEach(async () => {
      await clearGraph(sandbox);
      await g.addV(label("Finding")).property(t.id, "f-1").property("severity", "CRITICAL").property("source", "Semgrep").property("description", "SQL Injection in auth module").property("createdAt", "2025-09-15").next();
      await g.addV(label("Finding")).property(t.id, "f-2").property("severity", "HIGH").property("source", "Trivy").property("description", "CVE-2024-1234 in openssl").property("createdAt", "2025-10-01").next();
      await g.addV(label("Finding")).property(t.id, "f-3").property("severity", "CRITICAL").property("source", "Semgrep").property("description", "XSS vulnerability").property("createdAt", "2025-08-01").next();
      await g.addV(label("RepositoryBranch")).property(t.id, "branch-1").property("ref", "main").next();
      await g.addE("FOUND_IN").from_(__.V("f-1")).to(__.V("branch-1")).next();
      await g.addE("FOUND_IN").from_(__.V("f-2")).to(__.V("branch-1")).next();
    });

    it("groupCount by severity", async () => {
      const counts = await g.V().hasLabel("Finding").groupCount().by("severity").next();
      const map = counts.value as Map<string, number>;
      expect(map.get("CRITICAL")).toBe(2);
      expect(map.get("HIGH")).toBe(1);
    });

    it("P.within() filtering", async () => {
      const results = await g.V().hasLabel("Finding")
        .has("severity", P.within("CRITICAL", "HIGH"))
        .count().next();
      expect(results.value).toBe(3);
    });

    it("TextP.containing() text search", async () => {
      const results = await g.V().hasLabel("Finding")
        .has("description", TextP.containing("SQL Injection"))
        .values("description").toList();
      expect(results.length).toBe(1);
      expect(results[0]).toContain("SQL Injection");
    });

    it("order().by().limit() pagination", async () => {
      const results = await g.V().hasLabel("Finding")
        .order().by("createdAt", Order.desc)
        .limit(2)
        .values("createdAt").toList();
      expect(results.length).toBe(2);
      // Most recent first
      expect(results[0]).toBe("2025-10-01");
    });

    it("reverse edge traversal with multi-label", async () => {
      const findings = await g.V("branch-1").in_("FOUND_IN").hasLabel("Finding").values("severity").toList();
      expect(findings.sort()).toEqual(["CRITICAL", "HIGH"]);
    });

    it("project() with elementMap()", async () => {
      const results = await g.V("f-1")
        .project("finding", "branch")
        .by(__.elementMap())
        .by(__.out("FOUND_IN").elementMap())
        .toList();
      expect(results.length).toBe(1);
      const row = results[0] as Map<string, unknown>;
      expect(row.get("finding")).toBeDefined();
      expect(row.get("branch")).toBeDefined();
    });
  });

  // =========================================================================
  // Soft delete pattern
  // =========================================================================

  describe("soft delete pattern", () => {
    it("marks stale vertices as deleted", async () => {
      const integrationId = "integration-gitlab-001";
      await g.addV(label("Finding")).property(t.id, "f-old").property("integrationId", integrationId).property("updatedAt", "2025-01-01").next();
      await g.addV(label("Finding")).property(t.id, "f-new").property("integrationId", integrationId).property("updatedAt", "2025-12-01").next();

      const cutoff = "2025-06-01";
      await g.V().hasLabel("Finding")
        .has("integrationId", integrationId)
        .has("updatedAt", P.lt(cutoff))
        .property("deletedAt", "2025-12-15T00:00:00Z")
        .next();

      const deleted = await g.V("f-old").values("deletedAt").toList();
      expect(deleted).toEqual(["2025-12-15T00:00:00Z"]);

      // f-new should not be affected
      const notDeleted = await g.V("f-new").values("deletedAt").toList();
      expect(notDeleted).toEqual([]);
    });
  });

  // =========================================================================
  // Property cardinality (set)
  // =========================================================================

  describe("set cardinality for properties", () => {
    it("imageTags uses set cardinality (no duplicates)", async () => {
      await g.addV(label("ContainerImage"))
        .property(t.id, "img-1")
        .property("imageTag", "latest")
        .property("imageTag", "v1.0")
        .property("imageTag", "latest") // duplicate
        .next();

      const tags = await g.V("img-1").values("imageTag").toList();
      expect(tags.sort()).toEqual(["latest", "v1.0"]);
    });

    it("single cardinality overwrites", async () => {
      await g.addV(label("Finding"))
        .property(t.id, "f-1")
        .property(cardinality.single, "severity", "HIGH")
        .next();

      await g.V("f-1").property(cardinality.single, "severity", "CRITICAL").next();

      const severity = await g.V("f-1").values("severity").toList();
      expect(severity).toEqual(["CRITICAL"]);
    });
  });
});
