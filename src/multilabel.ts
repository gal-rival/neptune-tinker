import type { MultiLabelStrategy } from "./types.js";

/**
 * Multi-label support for TinkerGraph that emulates Neptune's `::` semantics.
 *
 * Neptune behavior:
 *   g.addV("A::B::C")          → vertex with labels A, B, C
 *   g.V().hasLabel("A")        → matches the above vertex
 *   g.V().label()              → returns "A::B::C"
 *   hasLabel("A::B::C")        → does NOT match (treated as literal in Neptune)
 *
 * Strategy "delimiter":
 *   Stores label as "A::B::C" natively. Patches hasLabel() to split on :: and
 *   match any component. Cheap, but hasLabel("A::B::C") would match the raw label
 *   in TinkerGraph (false positive vs Neptune). We guard against this.
 *
 * Strategy "property":
 *   Stores a hidden property `__labels` = Set<string> on each vertex.
 *   addV("A::B::C") → addV("A::B::C").property(set, "__labels", "A").property(set, "__labels", "B").property(set, "__labels", "C")
 *   hasLabel("X") → has("__labels", "X")
 *   label() remains "A::B::C" (matching Neptune's output format)
 */

const LABEL_DELIM = "::";
const HIDDEN_LABELS_KEY = "__labels";

// ---- Delimiter strategy helpers ----

/**
 * Given a raw label like "A::B::C", check if `target` is one of the components.
 */
export function delimiterHasLabel(rawLabel: string, target: string): boolean {
  if (target.includes(LABEL_DELIM)) {
    // Neptune: hasLabel("A::B::C") does NOT match. It's treated as a literal
    // that won't equal any single-component label.
    return false;
  }
  const parts = rawLabel.split(LABEL_DELIM);
  return parts.includes(target);
}

/**
 * Parse a Neptune-style multi-label string into individual labels.
 */
export function parseMultiLabel(label: string): string[] {
  return label.split(LABEL_DELIM).filter(Boolean);
}

/**
 * Join individual labels into Neptune format.
 */
export function joinMultiLabel(labels: string[]): string {
  return labels.join(LABEL_DELIM);
}

// ---- Property strategy helpers ----

/**
 * Build the extra .property() steps needed for the property strategy.
 * Returns Gremlin step snippets to chain after addV().
 */
export function propertyLabelSteps(rawLabel: string): Array<{ key: string; value: string }> {
  const labels = parseMultiLabel(rawLabel);
  return labels.map((l) => ({ key: HIDDEN_LABELS_KEY, value: l }));
}

// ---- Strategy context ----

export interface MultiLabelContext {
  strategy: MultiLabelStrategy;
}

/**
 * Rewrite a hasLabel() argument for the given strategy.
 *
 * For "property" strategy:
 *   hasLabel("X") → has("__labels", "X")  (caller must translate)
 *
 * For "delimiter" strategy:
 *   hasLabel("X") stays as-is; matching is handled post-hoc or with
 *   a traversal filter wrapping.
 *
 * Returns { rewrite: "hasLabel" | "has", args: [...] }
 */
export function rewriteHasLabel(
  strategy: MultiLabelStrategy,
  labelArg: string
): { type: "hasLabel"; args: [string] } | { type: "has"; args: [string, string] } {
  if (strategy === "property") {
    return { type: "has", args: [HIDDEN_LABELS_KEY, labelArg] };
  }
  // delimiter — caller should handle via filter or rely on native TinkerGraph matching
  return { type: "hasLabel", args: [labelArg] };
}

export { HIDDEN_LABELS_KEY, LABEL_DELIM };
