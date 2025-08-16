import { Grip } from "./grip";
import { GripContext } from "./context";
import { Tap } from "./tap";
import { Grok } from "./grok";
import { GripContextNode } from "./graph";

/**
 * Defines the interface for a pluggable resolver that manages producer-consumer
 * relationships within the Grip graph.
 */
export interface IGripResolver {
    /**
     * Called when a new consumer is added to a context.
     * It finds and links the appropriate producer.
     */
    addConsumer(context: GripContext, grip: Grip<any>): void;

    /**
     * Called when a consumer is removed from a context.
     * It unlinks it from its producer.
     */
    removeConsumer(context: GripContext, grip: Grip<any>): void;

    /**
     * Called when a new producer (tap) is added to a context.
     * It finds and re-links any descendant consumers that might be affected.
     */
    addProducer(context: GripContext, tap: Tap): void;

    /**
     * Called when a producer (tap) is removed from a context.
     * It finds and re-links any consumers that were linked to it.
     */
    removeProducer(context: GripContext, tap: Tap): void;

    /**
     * Called when a parent is added to a context.
     * It re-evaluates all consumers in the context and its descendants.
     */
    addParent(context: GripContext, parent: GripContext): void;

    /**
     * Called when a parent is removed from a context.
     * It re-evaluates all consumers in the context and its descendants.
     */
    unlinkParent(context: GripContext, parent: GripContext): void;
}

/**
 * A simple, correct implementation of the IGripResolver interface based on the
 * core algorithms defined in GRIP_GRAPH_OPS.md.
 */
export class SimpleResolver implements IGripResolver {
    private grok: Grok;

    constructor(grok: Grok) {
        this.grok = grok;
    }

    addConsumer(context: GripContext, grip: Grip<any>): void {
        const node = this.grok.ensureNode(context);
        this.resolveConsumer(node, grip);
    }

    removeConsumer(context: GripContext, grip: Grip<any>): void {
        const node = this.grok.ensureNode(context);
        this.unresolveConsumer(node, grip);
    }

    addProducer(context: GripContext, tap: Tap): void {
        const producerNode = this.grok.ensureNode(context);
        // Per the spec, we must re-evaluate all descendant consumers
        // that could be affected by the new producer's grips.
        const descendants = this.getDescendants(producerNode);
        const providedGrips = new Set(tap.provides);

        for (const descendant of descendants) {
            for (const [grip, _] of descendant.get_consumers()) {
                if (providedGrips.has(grip)) {
                    // This consumer might have a new, better producer. Re-resolve it.
                    this.resolveConsumer(descendant, grip);
                }
            }
        }
    }

    removeProducer(context: GripContext, tap: Tap): void {
        const producerNode = this.grok.ensureNode(context);
        const producerRecord = producerNode.getProducerRecord(tap);
        if (!producerRecord) return;

        // Find all consumers that were linked to this producer and re-resolve them.
        const destinations = Array.from(producerRecord.getDestinations().values());
        for (const destination of destinations) {
            const destNode = destination.getContextNode();
            for (const grip of destination.getGrips()) {
                // Unlink first, then find a new producer.
                this.unresolveConsumer(destNode, grip);
                this.resolveConsumer(destNode, grip);
            }
        }
    }

    addParent(context: GripContext, parent: GripContext): void {
        this.reevaluateDescendants(context);
    }

    unlinkParent(context: GripContext, parent: GripContext): void {
        this.reevaluateDescendants(context);
    }

    /**
     * Re-evaluates all consumers in a context and all of its descendants.
     * This is a costly operation, triggered by a change in parentage.
     */
    private reevaluateDescendants(context: GripContext): void {
        const startNode = this.grok.ensureNode(context);
        const descendants = [startNode, ...this.getDescendants(startNode)];
        for (const descendant of descendants) {
            for (const [grip, _] of descendant.get_consumers()) {
                this.resolveConsumer(descendant, grip);
            }
        }
    }

    /**
     * Resolves a single consumer and updates the graph state.
     */
    private resolveConsumer(node: GripContextNode, grip: Grip<any>): void {
        // First, unlink any existing producer to ensure a clean slate.
        this.unresolveConsumer(node, grip);
        
        const producerNode = this.findProducerFor(node, grip);

        if (producerNode) {
            // Link the consumer to the new producer.
            const producerRecord = producerNode.get_producers().get(grip);
            if (producerRecord) {
                producerRecord.addDestinationGrip(node, grip);
                node.setResolvedProvider(grip, producerNode);
            }
        }
    }

    /**
     * Unlinks a consumer from its current producer, if any.
     */
    private unresolveConsumer(destNode: GripContextNode, grip: Grip<any>): void {
        const resolvedProviders = destNode.getResolvedProviders();
        const producerNode = resolvedProviders.get(grip);
        if (producerNode) {
            producerNode.removeDestinationForContext(grip, destNode);
            resolvedProviders.delete(grip);
        }
    }

    /**
     * Finds the highest-priority producer for a given grip starting from a context node.
     * Implements the breadth-first, root-last search algorithm.
     */
    private findProducerFor(startNode: GripContextNode, grip: Grip<any>): GripContextNode | null {
        // 1. Check self
        if (startNode.get_producers().has(grip)) {
            return startNode;
        }

        const queue: GripContextNode[] = [];
        const visited = new Set<GripContextNode>();
        visited.add(startNode);
        
        // 2. Initial queue population: non-roots first, then roots.
        const parents = startNode.get_parent_nodes();
        const nonRoots = parents.filter(p => !p.get_context()?.isRoot());
        const roots = parents.filter(p => p.get_context()?.isRoot());
        queue.push(...nonRoots, ...roots);

        // 3. BFS search
        while (queue.length > 0) {
            const currentNode = queue.shift()!;

            if (visited.has(currentNode)) {
                continue;
            }
            visited.add(currentNode);

            if (currentNode.get_producers().has(grip)) {
                return currentNode; // Found the closest producer.
            }

            // Enqueue parents for the next level, maintaining root-last order.
            const nextParents = currentNode.get_parent_nodes();
            const nextNonRoots = nextParents.filter(p => !p.get_context()?.isRoot());
            const nextRoots = nextParents.filter(p => p.get_context()?.isRoot());
            queue.push(...nextNonRoots, ...nextRoots);
        }

        // 4. No producer found.
        return null;
    }

    /**
     * Performs a traversal to get all unique descendants of a starting node.
     */
    private getDescendants(startNode: GripContextNode): GripContextNode[] {
        const descendants = new Set<GripContextNode>();
        const queue = [...startNode.get_children_nodes()];
        const visited = new Set<GripContextNode>([startNode]);

        while (queue.length > 0) {
            const currentNode = queue.shift()!;
            if (visited.has(currentNode)) {
                continue;
            }
            visited.add(currentNode);
            descendants.add(currentNode);

            for (const child of currentNode.get_children_nodes()) {
                if (!visited.has(child)) {
                    queue.push(child);
                }
            }
        }
        return Array.from(descendants);
    }
}
