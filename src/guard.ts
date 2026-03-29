import type { GuardMode } from "./types.js";
import { NEPTUNE_UNSUPPORTED } from "./types.js";

export interface GuardViolation {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Lint a Gremlin query string for Neptune-incompatible patterns.
 *
 * This is a static text-based check — it catches the most common issues
 * without needing to parse the Gremlin AST. Not exhaustive, but catches
 * the patterns that actually bite people.
 */
export function lintQuery(query: string, mode: GuardMode = "strict"): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const sev = mode === "strict" ? "error" : "warning";

  // ---- Lambda detection ----
  // Lambdas in Gremlin text: { ... } blocks or Lambda.groovy(...)
  if (/\{[^}]*->/.test(query) || /Lambda\s*\./.test(query)) {
    violations.push({
      rule: "no-lambdas",
      message: "Neptune does not support lambda steps. Rewrite using built-in steps.",
      severity: sev,
    });
  }

  // ---- Groovy / Java code ----
  if (/System\s*\./.test(query) || /java\s*\.\s*lang/.test(query) || /new\s+Date\s*\(/.test(query)) {
    violations.push({
      rule: "no-groovy",
      message: "Neptune does not support Groovy/Java code in queries.",
      severity: sev,
    });
  }

  // ---- Variable declarations ----
  if (/^\s*\w+\s*=\s*[^=]/m.test(query) && !query.trimStart().startsWith("g.")) {
    violations.push({
      rule: "no-variables",
      message: "Neptune does not support variable declarations. Queries must start with `g.`.",
      severity: sev,
    });
  }

  // ---- Query must start with g ----
  const trimmed = query.trim();
  if (trimmed && !trimmed.startsWith("g.") && !trimmed.startsWith("g\n")) {
    violations.push({
      rule: "must-start-with-g",
      message: "All Neptune Gremlin queries must begin with `g.`",
      severity: sev,
    });
  }

  // ---- graph object ----
  // Match `graph.` (object access), not "graph" in string values
  if (/\bgraph\s*\./.test(query)) {
    violations.push({
      rule: "no-graph-object",
      message: "Neptune does not expose the `graph` object. Use `g` traversal only.",
      severity: sev,
    });
  }

  // ---- List cardinality ----
  if (/\blist\b/i.test(query) && /\.property\s*\(\s*list\b/i.test(query)) {
    violations.push({
      rule: "no-list-cardinality",
      message: "Neptune does not support `list` cardinality. Use `single` or `set`.",
      severity: sev,
    });
  }

  // ---- Unsupported methods ----
  if (/\.program\s*\(/.test(query)) {
    violations.push({
      rule: "no-program",
      message: "Neptune does not support the program() step.",
      severity: sev,
    });
  }

  // sideEffect with lambda (sideEffect with traversal is OK)
  // Heuristic: sideEffect({...}) or sideEffect(lambda)
  if (/\.sideEffect\s*\(\s*\{/.test(query)) {
    violations.push({
      rule: "no-sideeffect-consumer",
      message: "Neptune does not support sideEffect(Consumer). Use sideEffect(traversal) instead.",
      severity: sev,
    });
  }

  // ---- io().write() ----
  if (/\.io\s*\(.*\)\s*\.\s*write\s*\(/.test(query)) {
    violations.push({
      rule: "no-io-write",
      message: "Neptune does not support io().write(). io().read() is allowed.",
      severity: sev,
    });
  }

  // ---- Numeric IDs ----
  // Detect g.V(123) or g.addV().property(id, 123)
  if (/g\.V\s*\(\s*\d+\s*\)/.test(query) || /g\.E\s*\(\s*\d+\s*\)/.test(query)) {
    violations.push({
      rule: "string-ids-only",
      message: "Neptune requires string IDs. Use g.V('123') not g.V(123).",
      severity: sev,
    });
  }

  // ---- hasLabel with :: (Neptune treats this as literal, won't match) ----
  const hasLabelWithDelim = /\.hasLabel\s*\(\s*['"]([^'"]*::.*?)['"]\s*\)/.exec(query);
  if (hasLabelWithDelim) {
    violations.push({
      rule: "no-hasLabel-with-delimiter",
      message: `hasLabel("${hasLabelWithDelim[1]}") won't match in Neptune. The :: delimiter is only for addV(). Use hasLabel("SingleLabel") instead.`,
      severity: sev,
    });
  }

  // ---- materializeProperties ----
  if (/materializeProperties/.test(query)) {
    violations.push({
      rule: "no-materialize-properties",
      message: "Neptune does not support the materializeProperties flag.",
      severity: sev,
    });
  }

  // ---- Fully qualified class names ----
  if (/org\.apache\.tinkerpop/.test(query)) {
    violations.push({
      rule: "no-fqcn",
      message: "Neptune does not support fully qualified class names. Use short enum values (e.g. `single` not `VertexProperty.Cardinality.single`).",
      severity: sev,
    });
  }

  return violations;
}

/**
 * Throws or warns based on guard mode. Call before submitting a query.
 */
export function guardQuery(query: string, mode: GuardMode): void {
  const violations = lintQuery(query, mode);

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warning");

  for (const w of warnings) {
    console.warn(`[neptune-tinker] WARNING: ${w.rule} — ${w.message}`);
  }

  if (errors.length > 0) {
    const msg = errors.map((e) => `  [${e.rule}] ${e.message}`).join("\n");
    throw new NeptuneCompatError(
      `Neptune compatibility violations:\n${msg}`,
      errors
    );
  }
}

export class NeptuneCompatError extends Error {
  violations: GuardViolation[];
  constructor(message: string, violations: GuardViolation[]) {
    super(message);
    this.name = "NeptuneCompatError";
    this.violations = violations;
  }
}
