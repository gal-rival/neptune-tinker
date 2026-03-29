import gremlin from "gremlin";
import { LABEL_DELIM } from "./multilabel.js";

const { process: gprocess } = gremlin;
const { GraphTraversalSource, GraphTraversal, P, TextP, cardinality, t, statics: __ } = gprocess;

/**
 * Creates Neptune-aware GraphTraversalSource and GraphTraversal subclasses
 * that transparently handle:
 * - Multi-label emulation via :: delimiter matching
 * - Default set cardinality (Neptune's default, vs TinkerGraph's list default)
 *
 * Usage:
 *   const { Source, Traversal } = createNeptuneTraversal();
 *   const g = gprocess.traversal(Source, Traversal).withRemote(connection);
 *   // g is now a drop-in replacement that behaves like Neptune
 */
export function createNeptuneTraversal() {
  class NeptuneGraphTraversal extends GraphTraversal {
    /**
     * Override property() to default to set cardinality (Neptune behavior).
     * Neptune: .property('name', 'Alice') uses set cardinality.
     * TinkerGraph: .property('name', 'Alice') uses list cardinality.
     */
    property(...args: unknown[]) {
      if (args.length >= 2 && typeof args[0] === "string") {
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
      if (args.length === 1 && typeof args[0] === "string" && !args[0].includes(LABEL_DELIM)) {
        const label = args[0] as string;
        // Match label as a :: component with boundary checks.
        // "Person" matches "Person", "Person::Employee", "Employee::Person", "A::Person::B"
        // but NOT "PersonAdmin::Manager" (substring false-match prevention).
        return super.filter(
          __.or(
            __.label().is(P.eq(label)),
            __.label().is(TextP.startingWith(label + LABEL_DELIM)),
            __.label().is(TextP.endingWith(LABEL_DELIM + label)),
            __.label().is(TextP.containing(LABEL_DELIM + label + LABEL_DELIM)),
          ),
        );
      }
      return super.hasLabel(...args);
    }

    /**
     * Override has() to intercept label-related forms:
     * - has(T.label, value) — routes through multi-label hasLabel()
     * - has(label, key, value) — routes through multi-label hasLabel() + has(key, value)
     */
    has(...args: unknown[]) {
      if (args.length === 2 && args[0] === t.label && typeof args[1] === "string") {
        return this.hasLabel(args[1]);
      }
      if (args.length === 3 && typeof args[0] === "string" && typeof args[1] === "string") {
        const [label, key, value] = args;
        return this.hasLabel(label).has(key, value);
      }
      return super.has(...args);
    }

    /**
     * Override mid-traversal addV().
     */
    addV(...args: unknown[]) {
      super.addV(...args);
      return this;
    }
  }

  class NeptuneGraphTraversalSource extends GraphTraversalSource {
    addV(...args: unknown[]) {
      return super.addV(...args);
    }
  }

  // Neptune-aware anonymous traversal helpers (statics / __).
  // Standard gprocess.statics creates base GraphTraversal instances that
  // bypass our overrides. This Proxy creates NeptuneGraphTraversal instead,
  // so __.hasLabel("Person") inside where()/filter()/not() uses multi-label matching.
  const BytecodeClass = (__.identity() as unknown as { bytecode: { constructor: new () => unknown } }).bytecode.constructor;

  const neptuneStatics = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return (...args: unknown[]) => {
        const traversal = new NeptuneGraphTraversal(null, null, new BytecodeClass());
        const fn = (traversal as unknown as Record<string, unknown>)[prop];
        if (typeof fn === "function") {
          return (fn as Function).apply(traversal, args);
        }
        return undefined;
      };
    },
  });

  return {
    Source: NeptuneGraphTraversalSource,
    Traversal: NeptuneGraphTraversal,
    statics: neptuneStatics,
  };
}
