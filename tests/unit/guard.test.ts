import { describe, it, expect } from "vitest";
import { lintQuery, guardQuery, NeptuneCompatError } from "../../src/guard.js";
import type { GuardViolation } from "../../src/guard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert that linting `query` in strict mode produces a violation with the given rule. */
function expectViolation(query: string, rule: string) {
  const violations = lintQuery(query, "strict");
  const match = violations.find((v) => v.rule === rule);
  expect(match, `Expected rule "${rule}" to fire for: ${query}`).toBeDefined();
  expect(match!.severity).toBe("error");
}

/** Assert that linting `query` in strict mode does NOT produce the given rule. */
function expectNoViolation(query: string, rule: string) {
  const violations = lintQuery(query, "strict");
  const match = violations.find((v) => v.rule === rule);
  expect(match, `Expected rule "${rule}" NOT to fire for: ${query}`).toBeUndefined();
}

// ===========================================================================
// Rule: no-lambdas
// ===========================================================================

describe("no-lambdas", () => {
  const RULE = "no-lambdas";

  describe("detects lambda patterns", () => {
    it("catches closure-style lambda { it -> ... }", () => {
      expectViolation(`g.V().map{it -> it.get().value("name")}`, RULE);
    });

    it("catches Lambda.groovy()", () => {
      expectViolation(`g.V().map(Lambda.groovy("it.get()"))`, RULE);
    });

    it("catches Lambda.script()", () => {
      expectViolation(`g.V().filter(Lambda.script("g.V()"))`, RULE);
    });

    it("catches arrow in nested braces", () => {
      expectViolation(`g.V().sideEffect{x -> println x}`, RULE);
    });
  });

  describe("allows non-lambda patterns", () => {
    it("allows normal traversal steps", () => {
      expectNoViolation(`g.V().map(__.identity())`, RULE);
    });

    it("allows JSON-like braces without arrow", () => {
      expectNoViolation(`g.V().has("config", "{key: value}")`, RULE);
    });

    it("allows empty braces", () => {
      expectNoViolation(`g.V().has("json", "{}")`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-groovy
// ===========================================================================

describe("no-groovy", () => {
  const RULE = "no-groovy";

  describe("detects Groovy/Java patterns", () => {
    it("catches System.nanoTime()", () => {
      expectViolation(`g.V().has("ts", System.nanoTime())`, RULE);
    });

    it("catches System.out", () => {
      expectViolation(`g.V().sideEffect{System.out.println(it)}`, RULE);
    });

    it("catches java.lang references", () => {
      expectViolation(`g.V().map{java.lang.Math.abs(it.get())}`, RULE);
    });

    it("catches new Date()", () => {
      expectViolation(`g.V().has("created", new Date())`, RULE);
    });

    it("catches java . lang with spaces", () => {
      expectViolation(`g.V().map{java . lang.System.exit(0)}`, RULE);
    });
  });

  describe("allows non-Groovy patterns", () => {
    it("allows string value containing 'system'", () => {
      expectNoViolation(`g.V().has("system", "up")`, RULE);
    });

    it("allows normal property values", () => {
      expectNoViolation(`g.V().has("dateCreated", "2024-01-01")`, RULE);
    });

    it("does not flag 'System' without dot", () => {
      expectNoViolation(`g.V().has("name", "System")`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-variables
// ===========================================================================

describe("no-variables", () => {
  const RULE = "no-variables";

  describe("detects variable declarations", () => {
    it("catches simple assignment", () => {
      expectViolation(`x = g.V().count()`, RULE);
    });

    it("catches assignment with spaces", () => {
      expectViolation(`count = 5`, RULE);
    });

    it("catches multi-line with variable first", () => {
      expectViolation(`myVar = "hello"\ng.V()`, RULE);
    });
  });

  describe("allows valid queries", () => {
    it("allows g.V() queries", () => {
      expectNoViolation(`g.V().count()`, RULE);
    });

    it("allows g.addV() queries", () => {
      expectNoViolation(`g.addV("Person").property("name", "Alice")`, RULE);
    });

    it("allows query starting with g. even if = appears later", () => {
      // The rule checks if query starts with g. — if so, it skips
      expectNoViolation(`g.V().where(__.is(P.eq(1)))`, RULE);
    });
  });
});

// ===========================================================================
// Rule: must-start-with-g
// ===========================================================================

describe("must-start-with-g", () => {
  const RULE = "must-start-with-g";

  describe("detects queries not starting with g.", () => {
    it("catches V() without g prefix", () => {
      expectViolation(`V().hasLabel("Person")`, RULE);
    });

    it("catches random text", () => {
      expectViolation(`SELECT * FROM vertices`, RULE);
    });

    it("catches traversal() call", () => {
      // Also triggers no-graph-object, but we only check this rule
      expectViolation(`graph.traversal().V()`, RULE);
    });
  });

  describe("allows valid g. queries", () => {
    it("allows g.V()", () => {
      expectNoViolation(`g.V()`, RULE);
    });

    it("allows g.addV()", () => {
      expectNoViolation(`g.addV("Person")`, RULE);
    });

    it("allows leading whitespace", () => {
      expectNoViolation(`   g.V().count()`, RULE);
    });

    it("allows g followed by newline", () => {
      expectNoViolation(`g\n.V().count()`, RULE);
    });

    it("allows g.E()", () => {
      expectNoViolation(`g.E().count()`, RULE);
    });
  });

  describe("edge cases", () => {
    it("flags empty-ish whitespace string", () => {
      // Empty after trim → no violation (trimmed is falsy check)
      const violations = lintQuery("   ", "strict");
      const match = violations.find((v) => v.rule === RULE);
      expect(match).toBeUndefined();
    });
  });
});

// ===========================================================================
// Rule: no-graph-object
// ===========================================================================

describe("no-graph-object", () => {
  const RULE = "no-graph-object";

  describe("detects graph object access", () => {
    it("catches graph.traversal()", () => {
      expectViolation(`graph.traversal().V()`, RULE);
    });

    it("catches graph.features()", () => {
      expectViolation(`graph.features()`, RULE);
    });

    it("catches graph . io() with spaces", () => {
      expectViolation(`graph .io("file.json")`, RULE);
    });
  });

  describe("allows non-graph-object patterns", () => {
    it("allows property named 'graph'", () => {
      // \bgraph\s*\. matches word boundary — "graph" as property value
      // shouldn't have a dot after it in normal usage
      expectNoViolation(`g.V().has("type", "graph")`, RULE);
    });

    it("allows 'subgraph' (no word boundary match)", () => {
      // \bgraph catches "graph" but not "subgraph" since there's no word boundary before "graph" in "subgraph"
      // Wait — actually \bgraph would match "subgraph" at the "graph" part? No — \b is between "b" and "g" in "subgraph"
      // Actually "subgraph" contains "graph" and \b matches between non-word and word, or at word boundary.
      // In "subgraph.", the \b is before "s" and after "h" — \bgraph wouldn't match inside "subgraph"
      // because "graph" is preceded by "b" which is a word char, so there's no \b before "g" in "subgraph"
      expectNoViolation(`g.V().has("name", "subgraph.test")`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-list-cardinality
// ===========================================================================

describe("no-list-cardinality", () => {
  const RULE = "no-list-cardinality";

  describe("detects list cardinality", () => {
    it("catches .property(list, key, value)", () => {
      expectViolation(`g.V().property(list, "tags", "a")`, RULE);
    });

    it("catches .property(List, key, value) case-insensitive", () => {
      expectViolation(`g.V().property(List, "tags", "a")`, RULE);
    });

    it("catches .property( list, ...) with spaces", () => {
      expectViolation(`g.V().property( list, "tags", "a")`, RULE);
    });
  });

  describe("allows non-list patterns", () => {
    it("allows .property(set, key, value)", () => {
      expectNoViolation(`g.V().property(set, "tags", "a")`, RULE);
    });

    it("allows .property(single, key, value)", () => {
      expectNoViolation(`g.V().property(single, "name", "Alice")`, RULE);
    });

    it("allows 'list' as a string value without .property(list", () => {
      // The rule requires BOTH /\blist\b/i AND /\.property\s*\(\s*list\b/i
      expectNoViolation(`g.V().has("name", "playlist")`, RULE);
    });

    it("allows 'playlist' even in property context", () => {
      // "playlist" contains "list" as substring, but \blist\b won't match inside "playlist"
      // because there's no word boundary before "list" in "playlist"
      expectNoViolation(`g.V().has("playlist", "rock")`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-program
// ===========================================================================

describe("no-program", () => {
  const RULE = "no-program";

  describe("detects program() step", () => {
    it("catches .program(vp)", () => {
      expectViolation(`g.V().program(pageRank)`, RULE);
    });

    it("catches .program() with no args", () => {
      expectViolation(`g.V().program()`, RULE);
    });
  });

  describe("allows non-program patterns", () => {
    it("allows property named 'program'", () => {
      expectNoViolation(`g.V().has("program", "main")`, RULE);
    });

    it("allows 'program' without parenthesis", () => {
      expectNoViolation(`g.V().has("type", "program")`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-sideeffect-consumer
// ===========================================================================

describe("no-sideeffect-consumer", () => {
  const RULE = "no-sideeffect-consumer";

  describe("detects consumer-form sideEffect", () => {
    it("catches .sideEffect({...})", () => {
      expectViolation(`g.V().sideEffect({it -> println it})`, RULE);
    });

    it("catches .sideEffect( { with space", () => {
      expectViolation(`g.V().sideEffect( {println it})`, RULE);
    });
  });

  describe("allows traversal-form sideEffect", () => {
    it("allows .sideEffect(__.addV(...))", () => {
      expectNoViolation(`g.V().sideEffect(__.addV("Log"))`, RULE);
    });

    it("allows .sideEffect(traversal)", () => {
      expectNoViolation(`g.V().sideEffect(__.property("visited", true))`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-io-write
// ===========================================================================

describe("no-io-write", () => {
  const RULE = "no-io-write";

  describe("detects io().write()", () => {
    it("catches .io(file).write()", () => {
      expectViolation(`g.io("graph.xml").write()`, RULE);
    });

    it("catches .io(file) .write() with spaces", () => {
      expectViolation(`g.io("graph.xml") . write ()`, RULE);
    });
  });

  describe("allows io().read()", () => {
    it("allows .io(file).read()", () => {
      expectNoViolation(`g.io("graph.xml").read()`, RULE);
    });
  });
});

// ===========================================================================
// Rule: string-ids-only
// ===========================================================================

describe("string-ids-only", () => {
  const RULE = "string-ids-only";

  describe("detects numeric IDs", () => {
    it("catches g.V(123)", () => {
      expectViolation(`g.V(123)`, RULE);
    });

    it("catches g.E(456)", () => {
      expectViolation(`g.E(456)`, RULE);
    });

    it("catches g.V( 123 ) with spaces", () => {
      expectViolation(`g.V( 123 )`, RULE);
    });

    it("catches numeric ID in larger query", () => {
      expectViolation(`g.V(42).out("knows").hasLabel("Person")`, RULE);
    });
  });

  describe("allows string IDs", () => {
    it("allows g.V('abc')", () => {
      expectNoViolation(`g.V('abc')`, RULE);
    });

    it('allows g.V("abc")', () => {
      expectNoViolation(`g.V("abc-123")`, RULE);
    });

    it("allows g.V() with no args", () => {
      expectNoViolation(`g.V()`, RULE);
    });

    it("allows g.E() with no args", () => {
      expectNoViolation(`g.E()`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-hasLabel-with-delimiter (hasLabel form)
// ===========================================================================

describe("no-hasLabel-with-delimiter (hasLabel)", () => {
  const RULE = "no-hasLabel-with-delimiter";

  describe("detects hasLabel with ::", () => {
    it('catches hasLabel("A::B")', () => {
      expectViolation(`g.V().hasLabel("A::B")`, RULE);
    });

    it("catches hasLabel('A::B') with single quotes", () => {
      expectViolation(`g.V().hasLabel('A::B')`, RULE);
    });

    it('catches hasLabel("A::B::C") triple label', () => {
      expectViolation(`g.V().hasLabel("A::B::C")`, RULE);
    });
  });

  describe("allows single labels", () => {
    it('allows hasLabel("Person")', () => {
      expectNoViolation(`g.V().hasLabel("Person")`, RULE);
    });

    it("allows addV with :: (that's the correct usage)", () => {
      expectNoViolation(`g.addV("Person::Employee")`, RULE);
    });
  });

  describe("includes delimiter in error message", () => {
    it("message contains the offending label", () => {
      const violations = lintQuery(`g.V().hasLabel("Foo::Bar")`, "strict");
      const match = violations.find((v) => v.rule === RULE);
      expect(match).toBeDefined();
      expect(match!.message).toContain("Foo::Bar");
    });
  });
});

// ===========================================================================
// Rule: no-hasLabel-with-delimiter (T.label form)
// ===========================================================================

describe("no-hasLabel-with-delimiter (T.label)", () => {
  const RULE = "no-hasLabel-with-delimiter";

  describe("detects has(T.label, ...) with ::", () => {
    it('catches has(T.label, "A::B")', () => {
      expectViolation(`g.V().has(T.label, "A::B")`, RULE);
    });

    it('catches has(t.label, "A::B") lowercase', () => {
      expectViolation(`g.V().has(t.label, "A::B")`, RULE);
    });
  });

  describe("allows has(T.label, ...) without ::", () => {
    it('allows has(T.label, "Person")', () => {
      expectNoViolation(`g.V().has(T.label, "Person")`, RULE);
    });
  });

  describe("includes delimiter in error message", () => {
    it("message contains the offending label", () => {
      const violations = lintQuery(`g.V().has(T.label, "X::Y")`, "strict");
      const match = violations.find((v) => v.rule === RULE);
      expect(match).toBeDefined();
      expect(match!.message).toContain("X::Y");
    });
  });
});

// ===========================================================================
// Rule: no-materialize-properties
// ===========================================================================

describe("no-materialize-properties", () => {
  const RULE = "no-materialize-properties";

  describe("detects materializeProperties", () => {
    it("catches materializeProperties in query", () => {
      expectViolation(`g.with("materializeProperties", "all").V()`, RULE);
    });

    it("catches materializeProperties as step", () => {
      expectViolation(`g.V().materializeProperties("tokens")`, RULE);
    });
  });

  describe("allows non-matching patterns", () => {
    it("allows .properties()", () => {
      expectNoViolation(`g.V().properties()`, RULE);
    });

    it("allows .propertyMap()", () => {
      expectNoViolation(`g.V().propertyMap()`, RULE);
    });
  });
});

// ===========================================================================
// Rule: no-fqcn
// ===========================================================================

describe("no-fqcn", () => {
  const RULE = "no-fqcn";

  describe("detects fully qualified class names", () => {
    it("catches org.apache.tinkerpop.gremlin...", () => {
      expectViolation(
        `g.V().property(org.apache.tinkerpop.gremlin.structure.VertexProperty.Cardinality.single, "name", "Alice")`,
        RULE
      );
    });

    it("catches partial org.apache.tinkerpop reference", () => {
      expectViolation(`g.V().has(org.apache.tinkerpop.something)`, RULE);
    });
  });

  describe("allows non-FQCN patterns", () => {
    it("allows normal query without FQCN", () => {
      expectNoViolation(`g.V().has("org", "apache")`, RULE);
    });

    it("allows partial match (just org.apache)", () => {
      expectNoViolation(`g.V().has("domain", "org.apache")`, RULE);
    });
  });
});

// ===========================================================================
// Guard modes
// ===========================================================================

describe("guard mode behavior", () => {
  const LAMBDA_QUERY = `g.V().map{it -> it.get()}`;

  describe("strict mode", () => {
    it("returns severity: error", () => {
      const violations = lintQuery(LAMBDA_QUERY, "strict");
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe("error");
    });
  });

  describe("loose mode", () => {
    it("returns severity: warning", () => {
      const violations = lintQuery(LAMBDA_QUERY, "loose");
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe("warning");
    });
  });

  describe("defaults to strict", () => {
    it("uses strict when mode is omitted", () => {
      const violations = lintQuery(LAMBDA_QUERY);
      expect(violations[0].severity).toBe("error");
    });
  });
});

describe("guardQuery()", () => {
  describe("strict mode", () => {
    it("throws NeptuneCompatError for violations", () => {
      expect(() => guardQuery(`g.V(123)`, "strict")).toThrow(NeptuneCompatError);
    });

    it("error includes violations array", () => {
      try {
        guardQuery(`g.V(123)`, "strict");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NeptuneCompatError);
        const nErr = err as InstanceType<typeof NeptuneCompatError>;
        expect(nErr.violations).toBeInstanceOf(Array);
        expect(nErr.violations.length).toBeGreaterThan(0);
        expect(nErr.violations[0].rule).toBe("string-ids-only");
      }
    });

    it("does not throw for clean query", () => {
      expect(() => guardQuery(`g.V().hasLabel("Person").count()`, "strict")).not.toThrow();
    });
  });

  describe("loose mode", () => {
    it("does not throw even with violations", () => {
      expect(() => guardQuery(`g.V(123)`, "loose")).not.toThrow();
    });
  });
});

describe("multiple violations", () => {
  it("returns all matching violations for a query with multiple issues", () => {
    // This query has: lambda, groovy (System.), graph object, and doesn't start with g.
    const query = `graph.traversal().map{System.nanoTime() -> x}`;
    const violations = lintQuery(query, "strict");
    const rules = violations.map((v) => v.rule);
    expect(rules).toContain("no-lambdas");
    expect(rules).toContain("no-groovy");
    expect(rules).toContain("no-graph-object");
    expect(rules).toContain("must-start-with-g");
  });

  it("returns empty array for a clean query", () => {
    const violations = lintQuery(`g.V().hasLabel("Person").values("name")`, "strict");
    expect(violations).toEqual([]);
  });
});
