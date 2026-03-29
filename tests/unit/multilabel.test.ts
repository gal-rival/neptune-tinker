import { describe, it, expect } from "vitest";
import {
  parseMultiLabel,
  joinMultiLabel,
  delimiterHasLabel,
  propertyLabelSteps,
  rewriteHasLabel,
  LABEL_DELIM,
  HIDDEN_LABELS_KEY,
} from "../../src/multilabel.js";

// ===========================================================================
// Constants
// ===========================================================================

describe("constants", () => {
  it('LABEL_DELIM is "::"', () => {
    expect(LABEL_DELIM).toBe("::");
  });

  it('HIDDEN_LABELS_KEY is "__labels"', () => {
    expect(HIDDEN_LABELS_KEY).toBe("__labels");
  });
});

// ===========================================================================
// parseMultiLabel
// ===========================================================================

describe("parseMultiLabel", () => {
  it('splits "A::B::C" into ["A", "B", "C"]', () => {
    expect(parseMultiLabel("A::B::C")).toEqual(["A", "B", "C"]);
  });

  it('splits "A::B" into ["A", "B"]', () => {
    expect(parseMultiLabel("A::B")).toEqual(["A", "B"]);
  });

  it('keeps single label "A" as ["A"]', () => {
    expect(parseMultiLabel("A")).toEqual(["A"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseMultiLabel("")).toEqual([]);
  });

  it('filters empty components from "A::" (trailing delimiter)', () => {
    expect(parseMultiLabel("A::")).toEqual(["A"]);
  });

  it('filters empty components from "::A" (leading delimiter)', () => {
    expect(parseMultiLabel("::A")).toEqual(["A"]);
  });

  it('filters empty components from "A::::B" (double delimiter)', () => {
    expect(parseMultiLabel("A::::B")).toEqual(["A", "B"]);
  });

  it("handles real-world multi-label", () => {
    expect(parseMultiLabel("Person::Employee::Manager")).toEqual([
      "Person",
      "Employee",
      "Manager",
    ]);
  });
});

// ===========================================================================
// joinMultiLabel
// ===========================================================================

describe("joinMultiLabel", () => {
  it('joins ["A", "B"] into "A::B"', () => {
    expect(joinMultiLabel(["A", "B"])).toBe("A::B");
  });

  it('joins ["A"] into "A"', () => {
    expect(joinMultiLabel(["A"])).toBe("A");
  });

  it('joins [] into ""', () => {
    expect(joinMultiLabel([])).toBe("");
  });

  it('joins ["Person", "Employee", "Manager"] correctly', () => {
    expect(joinMultiLabel(["Person", "Employee", "Manager"])).toBe(
      "Person::Employee::Manager"
    );
  });

  it("roundtrips with parseMultiLabel", () => {
    const original = "Person::Employee::Manager";
    expect(joinMultiLabel(parseMultiLabel(original))).toBe(original);
  });
});

// ===========================================================================
// delimiterHasLabel
// ===========================================================================

describe("delimiterHasLabel", () => {
  describe("matches individual components", () => {
    it('finds "A" in "A::B::C"', () => {
      expect(delimiterHasLabel("A::B::C", "A")).toBe(true);
    });

    it('finds "B" in "A::B::C"', () => {
      expect(delimiterHasLabel("A::B::C", "B")).toBe(true);
    });

    it('finds "C" in "A::B::C"', () => {
      expect(delimiterHasLabel("A::B::C", "C")).toBe(true);
    });
  });

  describe("exact single label match", () => {
    it('finds "Person" in "Person"', () => {
      expect(delimiterHasLabel("Person", "Person")).toBe(true);
    });
  });

  describe("no match for non-existent component", () => {
    it('does not find "D" in "A::B::C"', () => {
      expect(delimiterHasLabel("A::B::C", "D")).toBe(false);
    });

    it('does not find "Manager" in "Person::Employee"', () => {
      expect(delimiterHasLabel("Person::Employee", "Manager")).toBe(false);
    });
  });

  describe("Neptune semantics: delimiter in target returns false", () => {
    it('returns false for target "A::B" even though raw is "A::B::C"', () => {
      expect(delimiterHasLabel("A::B::C", "A::B")).toBe(false);
    });

    it('returns false for target "A::B::C" (full raw label)', () => {
      expect(delimiterHasLabel("A::B::C", "A::B::C")).toBe(false);
    });

    it('returns false for target "Person::Employee"', () => {
      expect(delimiterHasLabel("Person::Employee", "Person::Employee")).toBe(false);
    });
  });

  describe("substring safety", () => {
    it('does not match "Admin" in "AdminAssistant::Manager"', () => {
      // "Admin" is not a component — "AdminAssistant" is
      expect(delimiterHasLabel("AdminAssistant::Manager", "Admin")).toBe(false);
    });

    it('does not match "Man" in "Person::Manager"', () => {
      expect(delimiterHasLabel("Person::Manager", "Man")).toBe(false);
    });

    it('matches exact "Manager" in "Person::Manager"', () => {
      expect(delimiterHasLabel("Person::Manager", "Manager")).toBe(true);
    });
  });
});

// ===========================================================================
// propertyLabelSteps
// ===========================================================================

describe("propertyLabelSteps", () => {
  it('returns steps for "A::B"', () => {
    expect(propertyLabelSteps("A::B")).toEqual([
      { key: "__labels", value: "A" },
      { key: "__labels", value: "B" },
    ]);
  });

  it('returns single step for "A" (no delimiter)', () => {
    expect(propertyLabelSteps("A")).toEqual([{ key: "__labels", value: "A" }]);
  });

  it("returns steps for triple label", () => {
    expect(propertyLabelSteps("Person::Employee::Manager")).toEqual([
      { key: "__labels", value: "Person" },
      { key: "__labels", value: "Employee" },
      { key: "__labels", value: "Manager" },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(propertyLabelSteps("")).toEqual([]);
  });
});

// ===========================================================================
// rewriteHasLabel
// ===========================================================================

describe("rewriteHasLabel", () => {
  describe("property strategy", () => {
    it("rewrites to has(__labels, label)", () => {
      const result = rewriteHasLabel("property", "Person");
      expect(result).toEqual({ type: "has", args: ["__labels", "Person"] });
    });

    it("uses __labels for any label", () => {
      const result = rewriteHasLabel("property", "Employee");
      expect(result.type).toBe("has");
      expect(result.args[0]).toBe("__labels");
      expect(result.args[1]).toBe("Employee");
    });
  });

  describe("delimiter strategy", () => {
    it("returns hasLabel unchanged", () => {
      const result = rewriteHasLabel("delimiter", "Person");
      expect(result).toEqual({ type: "hasLabel", args: ["Person"] });
    });

    it("preserves the label argument", () => {
      const result = rewriteHasLabel("delimiter", "Employee");
      expect(result.type).toBe("hasLabel");
      expect(result.args[0]).toBe("Employee");
    });
  });
});
