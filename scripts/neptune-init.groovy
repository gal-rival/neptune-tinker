import org.apache.tinkerpop.gremlin.process.traversal.*
import org.apache.tinkerpop.gremlin.process.traversal.step.*
import org.apache.tinkerpop.gremlin.process.traversal.step.filter.*
import org.apache.tinkerpop.gremlin.process.traversal.step.map.*
import org.apache.tinkerpop.gremlin.process.traversal.step.sideEffect.InjectStep
import org.apache.tinkerpop.gremlin.process.traversal.step.util.*
import org.apache.tinkerpop.gremlin.process.traversal.strategy.*
import org.apache.tinkerpop.gremlin.process.traversal.util.*
import org.apache.tinkerpop.gremlin.structure.Direction
import org.apache.tinkerpop.gremlin.structure.Element
import org.apache.tinkerpop.gremlin.structure.T
import org.apache.tinkerpop.gremlin.structure.VertexProperty

/**
 * Server-side TraversalStrategy that applies Neptune semantics to TinkerGraph.
 * Works for ALL clients (Python, Java, JS, Gremlin Console).
 *
 * 1. Label-append upsert: addV('B').property(T.id, existingId) appends label B
 * 2. Auto-UUID: addV() without T.id gets a UUID string ID (like Neptune)
 * 3. Multi-label: hasLabel("A") matches "A::B::C" vertices
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

    /**
     * Upsert a vertex: if a vertex with the given ID already exists,
     * append new label components (set-union); otherwise create a fresh vertex.
     * Preserves all properties and edges on append.
     */
    static Object upsertVertex(graph, String newLabel, Object id, List otherKvs) {
        def iter = graph.vertices(id)
        if (!iter.hasNext()) {
            // New vertex — create normally
            def kvs = [T.label, newLabel, T.id, id] + otherKvs
            return graph.addVertex(kvs as Object[])
        }

        def existing = iter.next()

        // Compute combined label (set union, preserving insertion order)
        def currentLabels = existing.label().split(DELIM) as LinkedHashSet
        def incomingLabels = newLabel.split(DELIM) as LinkedHashSet
        def combined = new LinkedHashSet(currentLabels)
        combined.addAll(incomingLabels)
        def combinedLabel = combined.join(DELIM)

        // If labels haven't changed, just apply new properties and return
        if (combinedLabel == existing.label()) {
            for (int i = 0; i < otherKvs.size() - 1; i += 2) {
                existing.property(VertexProperty.Cardinality.set, otherKvs[i] as String, otherKvs[i + 1])
            }
            return existing
        }

        // --- Labels changed: delete + recreate with combined label ---

        // Save all vertex properties
        def savedProps = []
        existing.properties().each { vp ->
            savedProps << [key: vp.key(), value: vp.value()]
        }

        // Save outgoing edges (including self-loops)
        def savedOutEdges = []
        existing.edges(Direction.OUT).each { e ->
            def edgeData = [id: e.id(), label: e.label(), inVId: e.inVertex().id(), props: []]
            e.properties().each { p -> edgeData.props << [key: p.key(), value: p.value()] }
            savedOutEdges << edgeData
        }

        // Save incoming edges (skip self-loops — already captured above)
        def savedInEdges = []
        existing.edges(Direction.IN).each { e ->
            if (e.outVertex().id() != id) {
                def edgeData = [id: e.id(), label: e.label(), outVId: e.outVertex().id(), props: []]
                e.properties().each { p -> edgeData.props << [key: p.key(), value: p.value()] }
                savedInEdges << edgeData
            }
        }

        // Delete existing vertex (cascades edge removal)
        existing.remove()

        // Recreate with combined label + new properties from addV params
        def kvs = [T.label, combinedLabel, T.id, id] + otherKvs
        def newVertex = graph.addVertex(kvs as Object[])

        // Restore saved properties (set cardinality merges with any new ones)
        savedProps.each { p ->
            newVertex.property(VertexProperty.Cardinality.set, p.key, p.value)
        }

        // Restore outgoing edges (self-loops point back to newVertex)
        savedOutEdges.each { e ->
            def inV = (e.inVId == id) ? newVertex : graph.vertices(e.inVId).next()
            def edge = newVertex.addEdge(e.label, inV, T.id, e.id)
            e.props.each { p -> edge.property(p.key, p.value) }
        }

        // Restore incoming edges
        savedInEdges.each { e ->
            def outV = graph.vertices(e.outVId).next()
            def edge = outV.addEdge(e.label, newVertex, T.id, e.id)
            e.props.each { p -> edge.property(p.key, p.value) }
        }

        return newVertex
    }

    /**
     * Extract label, id, and remaining key-values from an AddVertex step's parameters.
     * Returns null if the step has no T.id (not an upsert candidate).
     *
     * Uses reflection to access the raw parameter map because
     * Parameters.getKeyValues() requires a Traverser.Admin (unavailable at strategy time).
     */
    private static Map extractAddVParams(step, Traversal.Admin traversal) {
        def params = step.getParameters()
        if (!params.contains(T.id)) return null

        def field = params.getClass().getDeclaredField('parameters')
        field.setAccessible(true)
        def rawMap = field.get(params) as Map<Object, List>

        def label = rawMap.containsKey(T.label) ? rawMap.get(T.label).first() as String : "vertex"
        def id = rawMap.containsKey(T.id) ? rawMap.get(T.id).first() : null

        def otherKvs = []
        rawMap.each { key, values ->
            if (key != T.label && key != T.id) {
                values.each { v -> otherKvs.addAll([key, v]) }
            }
        }

        return [label: label, id: id, otherKvs: otherKvs]
    }

    @Override
    void apply(Traversal.Admin traversal) {
        // --- Label-append upsert for addV() with explicit T.id ---
        // Must run BEFORE auto-UUID (which handles the no-T.id case).
        // Replaces AddVertexStartStep/AddVertexStep with inject+map or map
        // that performs Neptune-style upsert at execution time.

        def addVStartReplacements = []
        for (def step : TraversalHelper.getStepsOfClass(AddVertexStartStep.class, traversal)) {
            def extracted = extractAddVParams(step, traversal)
            if (extracted == null) continue
            addVStartReplacements << [step, extracted]
        }
        for (def entry : addVStartReplacements) {
            def step = entry[0]
            def ex = entry[1]
            def fLabel = ex.label, fId = ex.id, fOtherKvs = ex.otherKvs

            // Start step: inject a seed traverser, then map to vertex via upsert
            def injectStep = new InjectStep(traversal, 1L)
            def mapStep = new LambdaMapStep(traversal, { Traverser tr ->
                upsertVertex(traversal.getGraph().get(), fLabel, fId, fOtherKvs)
            } as java.util.function.Function)

            TraversalHelper.insertBeforeStep(injectStep, step, traversal)
            TraversalHelper.insertAfterStep(mapStep, injectStep, traversal)
            traversal.removeStep(step)
        }

        def addVMidReplacements = []
        for (def step : TraversalHelper.getStepsOfClass(AddVertexStep.class, traversal)) {
            def extracted = extractAddVParams(step, traversal)
            if (extracted == null) continue
            addVMidReplacements << [step, extracted]
        }
        for (def entry : addVMidReplacements) {
            def step = entry[0]
            def ex = entry[1]
            def fLabel = ex.label, fId = ex.id, fOtherKvs = ex.otherKvs

            // Mid-traversal: map incoming traverser to vertex via upsert
            def mapStep = new LambdaMapStep(traversal, { Traverser tr ->
                upsertVertex(traversal.getGraph().get(), fLabel, fId, fOtherKvs)
            } as java.util.function.Function)

            TraversalHelper.insertBeforeStep(mapStep, step, traversal)
            traversal.removeStep(step)
        }

        // --- Auto-UUID for addV() without explicit T.id ---
        // Neptune auto-generates UUID string IDs. TinkerGraph generates numeric Longs
        // that the JS driver can't look up. Inject a UUID when no T.id is specified.
        // Only fires for steps NOT already replaced above.
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
