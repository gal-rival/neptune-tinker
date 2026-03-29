/**
 * Multi-label support for TinkerGraph that emulates Neptune's `::` semantics.
 *
 * Neptune behavior:
 *   g.addV("A::B::C")          → vertex with labels A, B, C
 *   g.V().hasLabel("A")        → matches the above vertex
 *   g.V().label()              → returns "A::B::C"
 *   hasLabel("A::B::C")        → does NOT match (treated as literal in Neptune)
 *
 * Stores label as "A::B::C" natively in TinkerGraph. The traversal overrides
 * (see neptune-traversal.ts) intercept hasLabel() to split on :: and match
 * any component with proper boundary checks.
 */

export const LABEL_DELIM = "::";

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
