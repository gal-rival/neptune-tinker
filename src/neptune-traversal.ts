import gremlin from "gremlin";
import type { MultiLabelStrategy } from "./types.js";
import { parseMultiLabel, HIDDEN_LABELS_KEY, LABEL_DELIM } from "./multilabel.js";

const { process: gprocess } = gremlin;
const { GraphTraversalSource, GraphTraversal, P, TextP, cardinality, statics: __ } = gprocess;

export interface NeptuneTraversalConfig {
  multiLabelStrategy: MultiLabelStrategy;
}

/**
 * Creates Neptune-aware GraphTraversalSource and GraphTraversal subclasses
 * that transparently handle:
 * - Multi-label emulation (delimiter or property strategy)
 * - Default set cardinality (Neptune's default, vs TinkerGraph's list default)
 *
 * Usage:
 *   const { Source, Traversal } = createNeptuneTraversal(config);
 *   const g = gprocess.traversal(Source, Traversal).withRemote(connection);
 *   // g is now a drop-in replacement that behaves like Neptune
 */
export function createNeptuneTraversal(config: NeptuneTraversalConfig) {
  const strategy = config.multiLabelStrategy;

  class NeptuneGraphTraversal extends GraphTraversal {
    /**
     * Override property() to default to set cardinality (Neptune behavior).
     * Neptune: .property('name', 'Alice') uses set cardinality.
     * TinkerGraph: .property('name', 'Alice') uses list cardinality.
     */
    property(...args: unknown[]) {
      if (args.length >= 2 && typeof args[0] === "string") {
        // No cardinality specified — inject set (Neptune default)
        return super.property(cardinality.set, ...args);
      }
      return super.property(...args);
    }

    /**
     * Override hasLabel() to handle multi-label matching.
     * Neptune: hasLabel("Person") matches a vertex with label "Person::Employee".
     * TinkerGraph: hasLabel("Person") does NOT match label "Person::Employee".
     */
    hasLabel(...args: unknown[]) {
      // Only intercept single string label without :: (the common case)
      if (args.length === 1 && typeof args[0] === "string" && !args[0].includes(LABEL_DELIM)) {
        const label = args[0] as string;

        if (strategy === "property") {
          return super.has(HIDDEN_LABELS_KEY, label);
        }

        // Delimiter strategy: match label as a :: component
        // "Person" matches "Person", "Person::Employee", "Employee::Person", "A::Person::B"
        return super.filter(
          __.or(
            __.label().is(P.eq(label)),
            __.label().is(TextP.containing(LABEL_DELIM + label)),
            __.label().is(TextP.containing(label + LABEL_DELIM)),
          ),
        );
      }
      return super.hasLabel(...args);
    }

    /**
     * Override mid-traversal addV() to apply multi-label property strategy.
     */
    addV(...args: unknown[]) {
      super.addV(...args);
      const label = args[0];
      if (strategy === "property" && typeof label === "string" && label.includes(LABEL_DELIM)) {
        for (const l of parseMultiLabel(label)) {
          super.property(cardinality.set, HIDDEN_LABELS_KEY, l);
        }
      }
      return this;
    }
  }

  class NeptuneGraphTraversalSource extends GraphTraversalSource {
    /**
     * Override addV() to apply multi-label property strategy.
     * With "property" strategy, addV("A::B") automatically adds
     * .property(set, "__labels", "A").property(set, "__labels", "B")
     */
    addV(...args: unknown[]) {
      let traversal = super.addV(...args);
      const label = args[0];
      if (strategy === "property" && typeof label === "string" && label.includes(LABEL_DELIM)) {
        for (const l of parseMultiLabel(label)) {
          traversal = traversal.property(cardinality.set, HIDDEN_LABELS_KEY, l);
        }
      }
      return traversal;
    }
  }

  return {
    Source: NeptuneGraphTraversalSource,
    Traversal: NeptuneGraphTraversal,
  };
}
