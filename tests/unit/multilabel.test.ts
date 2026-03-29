import { describe, it, expect } from "vitest";
import {
  parseMultiLabel,
  joinMultiLabel,
  delimiterHasLabel,
  LABEL_DELIM,
} from "../../src/multilabel.js";

// ===========================================================================
// Constants
// ===========================================================================

describe("constants", () => {
  it('LABEL_DELIM is "::"', () => {
    expect(LABEL_DELIM).toBe("::");
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

