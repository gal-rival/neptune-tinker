import org.apache.tinkerpop.gremlin.process.traversal.*
import org.apache.tinkerpop.gremlin.process.traversal.step.*
import org.apache.tinkerpop.gremlin.process.traversal.step.filter.*
import org.apache.tinkerpop.gremlin.process.traversal.step.map.*
import org.apache.tinkerpop.gremlin.process.traversal.step.util.*
import org.apache.tinkerpop.gremlin.process.traversal.strategy.*
import org.apache.tinkerpop.gremlin.process.traversal.util.*
import org.apache.tinkerpop.gremlin.structure.T
import org.apache.tinkerpop.gremlin.structure.Element

/**
 * Server-side TraversalStrategy that applies Neptune semantics to TinkerGraph.
 * Works for ALL clients (Python, Java, JS, Gremlin Console).
 *
 * 1. Multi-label: hasLabel("A") matches "A::B::C" vertices
 * 2. Auto-UUID: addV() without T.id gets a UUID string ID (like Neptune)
 */
class NeptuneMultiLabelStrategy extends AbstractTraversalStrategy<TraversalStrategy.DecorationStrategy> {

    private static final String DELIM = "::"

    static boolean matchesLabel(String rawLabel, String target) {
        if (target.contains(DELIM)) return false  // "A::B" never matches in Neptune
        if (rawLabel == target) return true
        if (rawLabel.startsWith(target + DELIM)) return true
        if (rawLabel.endsWith(DELIM + target)) return true
        if (rawLabel.contains(DELIM + target + DELIM)) return true
        return false
    }

    @Override
    void apply(Traversal.Admin traversal) {
        // --- Auto-UUID for addV() without explicit T.id ---
        // Neptune auto-generates UUID string IDs. TinkerGraph generates numeric Longs
        // that the JS driver can't look up. Inject a UUID when no T.id is specified.
        for (def step : TraversalHelper.getStepsOfClass(AddVertexStartStep.class, traversal)) {
            def params = step.getParameters()
            if (!params.contains(T.id)) {
                step.configure(T.id, UUID.randomUUID().toString())
            }
        }
        for (def step : TraversalHelper.getStepsOfClass(AddVertexStep.class, traversal)) {
            def params = step.getParameters()
            if (!params.contains(T.id)) {
                step.configure(T.id, UUID.randomUUID().toString())
            }
        }

        // --- Multi-label hasLabel() rewriting ---
        def replacements = []

        def steps = TraversalHelper.getStepsOfClass(HasStep.class, traversal)
        for (HasStep step : steps) {
            def containers = step.getHasContainers()
            def labelContainers = containers.findAll { it.key == T.label.accessor }
            def nonLabelContainers = containers.findAll { it.key != T.label.accessor }

            if (labelContainers.isEmpty()) continue

            // Collect all label targets from all label containers
            def allTargets = []
            boolean canHandle = true

            for (def container : labelContainers) {
                def predicate = container.getPredicate()

                if (predicate.biPredicate == Compare.eq && predicate.value instanceof String) {
                    allTargets << [type: "eq", value: predicate.value as String]
                } else if (predicate.biPredicate == Contains.within && predicate.value instanceof Collection) {
                    allTargets << [type: "within", value: predicate.value as Collection<String>]
                } else {
                    canHandle = false
                    break
                }
            }

            if (!canHandle || allTargets.isEmpty()) continue

            // Build a filter predicate that checks ALL label conditions (AND semantics)
            replacements << [step, nonLabelContainers, { Traverser tr ->
                def element = tr.get()
                if (!(element instanceof Element)) return false
                def label = element.label()

                // Every label target must match (AND semantics for chained hasLabel)
                for (def target : allTargets) {
                    if (target.type == "eq") {
                        if (!matchesLabel(label, target.value)) return false
                    } else if (target.type == "within") {
                        boolean anyMatch = target.value.any { t -> matchesLabel(label, t as String) }
                        if (!anyMatch) return false
                    }
                }
                return true
            } as java.util.function.Predicate]
        }

        // Apply replacements
        for (def entry : replacements) {
            def originalStep = entry[0] as Step
            def nonLabelContainers = entry[1] as List
            def filterStep = new LambdaFilterStep(traversal, entry[2])

            if (nonLabelContainers.isEmpty()) {
                // Pure label step — replace entirely
                TraversalHelper.insertBeforeStep(filterStep, originalStep, traversal)
                traversal.removeStep(originalStep)
            } else {
                // Mixed step (label + property filters) — insert label filter before,
                // remove label containers from the HasStep, keep property containers
                TraversalHelper.insertBeforeStep(filterStep, originalStep, traversal)
                for (def lc : (originalStep as HasStep).getHasContainers().findAll { it.key == T.label.accessor }) {
                    (originalStep as HasStep).removeHasContainer(lc)
                }
            }
        }
    }
}

// Register globals
def globals = [:]

globals << [hook : [
  onStartUp: { ctx ->
    ctx.logger.info("Neptune multi-label strategy loaded.")
  },
  onShutDown: { ctx ->
    ctx.logger.info("Shutting down Neptune sandbox.")
  }
] as LifeCycleHook]

// Bind g with the Neptune multi-label strategy applied
globals << [g : traversal().withEmbedded(graph).withStrategies(new NeptuneMultiLabelStrategy())]
