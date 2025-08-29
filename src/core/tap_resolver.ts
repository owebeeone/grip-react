import { Grip } from "./grip";
import { GripContext } from "./context";
import { Tap, TapFactory } from "./tap";
import { Grok } from "./grok";
import { GripContextNode, ProducerRecord } from "./graph";
import { EvaluationDelta, TapAttribution } from "./query_evaluator";
import { consola } from "consola";

const logger = consola.withTag("core/tap_resolver.ts");

function intersection<T>(setA: Set<T>, iterable: Iterable<T>): Set<T> {
  const result = new Set<T>();
  for (const item of iterable) {
    if (setA.has(item)) {
      result.add(item);
    }
  }
  return result;
}

function difference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of setA) {
    if (!setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

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
  addProducer(context: GripContext, tap: Tap | TapFactory): void;

  /**
   * Called when a producer (tap) is removed from a context.
   * It finds and re-links any consumers that were linked to it.
   */
  removeProducer(context: GripContext, tap: Tap | TapFactory): void;

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

  /**
   * Called when a producer delta is applied to a context.
   * It updates the graph to reflect the new producer state.
   */
  applyProducerDelta(context: GripContext | GripContextNode, delta: EvaluationDelta): void;
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
    // Ensure the consumer is recorded on the node so future re-evaluations can find it
    node.getOrCreateConsumer(grip);
    this.resolveConsumer(node, grip);
  }

  removeConsumer(context: GripContext, grip: Grip<any>): void {
    const node = this.grok.ensureNode(context);
    this.unresolveConsumer(node, grip);
    // Remove the consumer from the node's registry
    node.removeConsumerForGrip(grip);
  }

  applyProducerDelta(context: GripContext | GripContextNode, delta: EvaluationDelta): void {
    const node = context.kind === "GripContext" ? context.getNode() : context;
    if (process.env.NODE_ENV !== "production")
      logger.log(`[SimpleResolver] applyProducerDelta: Queuing delta application for ${node.id}`);

    node.submitTask(() => {
      if (process.env.NODE_ENV !== "production")
        logger.log(
          `[SimpleResolver] applyProducerDelta: Executing queued delta application for ${node.id}`,
        );
      // --- Step 1: Collect all affected consumers before making any changes ---
      const consumersToReResolve = new Set<{ destNode: GripContextNode; grip: Grip<any> }>();
      for (const [tap, attribution] of delta.removed.entries()) {
        const producerRecord = node.getProducerRecord(tap);
        if (producerRecord) {
          for (const grip of attribution.attributedGrips) {
            this.collectConsumers(producerRecord, grip, consumersToReResolve);
          }
        }
      }

      // --- Step 2: Apply all structural changes to the graph ---

      // Process removals
      for (const [tap, attribution] of delta.removed.entries()) {
        const producerRecord = node.getProducerRecord(tap);
        if (producerRecord) {
          for (const grip of attribution.attributedGrips) {
            // Only remove the producer for this grip if it's the one currently assigned
            if (node.get_producers().get(grip) === producerRecord) {
              node.get_producers().delete(grip);
            }
            producerRecord.outputs.delete(grip);
          }
        }
      }

      // Process additions
      for (const [tapOrFactory, attribution] of delta.added.entries()) {
        // Pass the tap or factory directly to getOrCreateProducerRecord
        // ProducerRecord will handle building the tap if it's a factory
        const producerRecord = node.getOrCreateProducerRecord(tapOrFactory, tapOrFactory.provides);

        // Ensure the tap is properly attached if it isn't already
        const nodeContext = node.get_context();
        const tapInstance = producerRecord.tap;
        if (nodeContext && !tapInstance.getHomeContext?.()) {
          tapInstance.onAttach?.(nodeContext);
        }

        for (const grip of attribution.attributedGrips) {
          // This will overwrite any existing producer for the grip, which is intended.
          node.recordProducer(grip, producerRecord);
          producerRecord.outputs.add(grip);
        }
      }

      // --- Step 3: Trigger Batched Re-resolution for removals and any new consumers ---
      const descendants = [node, ...this.getDescendants(node)];
      for (const [tap, attribution] of delta.added.entries()) {
        for (const grip of attribution.attributedGrips) {
          for (const descendant of descendants) {
            if (descendant.get_consumers().has(grip)) {
              consumersToReResolve.add({ destNode: descendant, grip });
            }
          }
        }
      }

      for (const { destNode, grip } of consumersToReResolve) {
        this.unresolveConsumer(destNode, grip);
        this.resolveConsumer(destNode, grip);
      }

      // --- Step 4: Cleanup ---
      const tapsInDelta = new Set([...delta.added.keys(), ...delta.removed.keys()]);
      for (const tap of tapsInDelta) {
        const producerRecord = node.getProducerRecord(tap);
        if (producerRecord && producerRecord.outputs.size === 0) {
          node._removeTap(tap);
        }
      }
    }, 100); // Schedule as a low-priority task
  }

  private analyzeDelta(node: GripContextNode, delta: EvaluationDelta) {
    // 1. Determine the current state of producers
    const currentProducers = new Map<Tap | TapFactory, Set<Grip<any>>>();
    for (const [grip, producerRecord] of node.get_producers().entries()) {
      const tap = producerRecord.tapFactory ?? producerRecord.tap;
      if (!currentProducers.has(tap)) {
        currentProducers.set(tap, new Set());
      }
      currentProducers.get(tap)!.add(grip);
    }

    // 2. Calculate the final (desired) state based on the delta
    const finalProducers = new Map<Tap | TapFactory, TapAttribution>();
    const tempFinalGrips = new Map<Tap | TapFactory, Set<Grip<any>>>();

    // Start with current state
    for (const [tap, grips] of currentProducers.entries()) {
      const rec = node.getProducerRecord(tap)!; // Should exist
      tempFinalGrips.set(tap, new Set(grips));
      finalProducers.set(tap, {
        producerTap: tap,
        score: 0,
        bindingId: "",
        attributedGrips: tempFinalGrips.get(tap)!,
      });
    }

    // Apply removals from delta
    for (const [tap, attribution] of delta.removed.entries()) {
      const finalGrips = tempFinalGrips.get(tap);
      if (finalGrips) {
        for (const grip of attribution.attributedGrips) {
          finalGrips.delete(grip);
        }
        if (finalGrips.size === 0) {
          tempFinalGrips.delete(tap);
          finalProducers.delete(tap);
        }
      }
    }
    // Apply additions from delta
    for (const [tap, attribution] of delta.added.entries()) {
      if (!tempFinalGrips.has(tap)) {
        tempFinalGrips.set(tap, new Set());
      }
      const finalGrips = tempFinalGrips.get(tap)!;
      for (const grip of attribution.attributedGrips) {
        finalGrips.add(grip);
      }
      finalProducers.set(tap, { ...attribution, attributedGrips: finalGrips });
    }

    // 3. Compare current and final states to determine added, removed, and transferred
    const added = new Map<Tap | TapFactory, Set<Grip<any>>>();
    const removed = new Map<Tap | TapFactory, Set<Grip<any>>>();
    const transferred = new Map<Grip<any>, { from: Tap | TapFactory; to: Tap | TapFactory }>();

    const allGrips = new Set<Grip<any>>();
    currentProducers.forEach((grips) => grips.forEach((g) => allGrips.add(g)));
    tempFinalGrips.forEach((grips) => grips.forEach((g) => allGrips.add(g)));

    for (const grip of allGrips) {
      const oldTap = this.findTapForGrip(grip, currentProducers);
      const newTap = this.findTapForGrip(grip, tempFinalGrips);

      if (oldTap && !newTap) {
        if (!removed.has(oldTap)) removed.set(oldTap, new Set());
        removed.get(oldTap)!.add(grip);
      } else if (!oldTap && newTap) {
        if (!added.has(newTap)) added.set(newTap, new Set());
        added.get(newTap)!.add(grip);
      } else if (oldTap && newTap && oldTap !== newTap) {
        transferred.set(grip, { from: oldTap, to: newTap });
      }
    }
    return { added, removed, transferred, finalProducers };
  }

  private findTapForGrip(
    grip: Grip<any>,
    map: Map<Tap | TapFactory, Set<Grip<any>>>,
  ): Tap | TapFactory | undefined {
    for (const [tap, grips] of map.entries()) {
      if (grips.has(grip)) {
        return tap;
      }
    }
    return undefined;
  }

  private collectConsumers(
    producerRecord: ProducerRecord,
    grip: Grip<any>,
    consumersToReResolve: Set<{ destNode: GripContextNode; grip: Grip<any> }>,
  ) {
    for (const destination of producerRecord.getDestinations().values()) {
      if (destination.getGrips().has(grip)) {
        consumersToReResolve.add({ destNode: destination.getContextNode(), grip });
      }
    }
  }

  addProducer(context: GripContext, tap: Tap): void {
    // Attach tap to context so it tracks its home and sets up producer record
    tap.onAttach?.(context);
    const producerNode = this.grok.ensureNode(context);
    const producerRecord = producerNode.getOrCreateProducerRecord(tap, tap.provides);

    // Defensive: ensure tap instance reflects attachment even if onAttach was a no-op
    try {
      (tap as any).producer = (tap as any).producer ?? producerRecord;
      (tap as any).homeContext = (tap as any).homeContext ?? context;
      (tap as any).engine = (tap as any).engine ?? this.grok;
    } catch {}

    // Ensure all provided grips are mapped to this producer record on the producer node
    for (const grip of tap.provides) {
      producerNode.recordProducer(grip, producerRecord);
    }

    // Ensure the tap is now considered attached (home/prod already recorded by onAttach)
    // Per the spec, we must re-evaluate all consumers in the producer's
    // own context and all descendant consumers that could be affected.
    const descendants = [producerNode, ...this.getDescendants(producerNode)];
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

  removeProducer(context: GripContext, tap: Tap | TapFactory): void {
    const producerNode = this.grok.ensureNode(context);
    const producerRecord = producerNode.getProducerRecord(tap);
    if (!producerRecord) return;

    // Snapshot all (destination, grip) pairs to re-evaluate after removal
    const pairs: Array<{ destNode: GripContextNode; grip: Grip<any> }> = [];
    for (const destination of Array.from(producerRecord.getDestinations().values())) {
      const destNode = destination.getContextNode();
      for (const grip of destination.getGrips()) {
        pairs.push({ destNode, grip });
      }
    }

    // Remove the grip -> producer mapping for this tap's grips if pointing to this record
    for (const grip of tap.provides) {
      const current = producerNode.get_producers().get(grip);
      if (current === producerRecord) {
        producerNode.get_producers().delete(grip);
      }
    }

    // Remove the producer record from the node and notify tap.
    // The tap can be a tap factory, so we need to let the node handle it
    // as it will have the real tap instance.
    producerNode._removeTap(tap);

    // Now unresolve and re-resolve each affected destination/grip
    for (const { destNode, grip } of pairs) {
      // Remove resolved link if currently pointing to this producer
      const resolvedProviders = destNode.getResolvedProviders();
      const linkedNode = resolvedProviders.get(grip);
      if (linkedNode === producerNode) {
        resolvedProviders.delete(grip);
      }
      // Remove destination from the old record to keep it tidy
      producerRecord.removeDestinationGripForContext(destNode, grip);
      // Re-resolve to find next-best provider
      this.resolveConsumer(destNode, grip);
    }
  }

  addParent(context: GripContext, parent: GripContext): void {
    this.reevaluateDescendants(context);
  }

  unlinkParent(context: GripContext, parent: GripContext): void {
    // Update the graph to reflect the removed parent, then re-evaluate.
    // If the context implementation does not support unlinking, this is a no-op.
    (context as any).unlinkParent?.(parent);
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
      // Collect all grips for which this descendant has consumers
      const consumerGrips = Array.from(descendant.get_consumers().keys());
      for (const grip of consumerGrips) {
        this.resolveConsumer(descendant, grip);
      }
    }
  }

  /**
   * Resolves a single consumer and updates the graph state.
   */
  resolveConsumer(node: GripContextNode, grip: Grip<any>): void {
    const currentProducerNode = node.getResolvedProviders().get(grip);
    const newProducerNode = this.findProducerFor(node, grip);

    // If the new producer is different, or if we previously had a producer and now don't (or vice versa)
    if (currentProducerNode !== newProducerNode) {
      // Unlink from the old producer if it existed
      if (currentProducerNode) {
        this.unresolveConsumer(node, grip);
      }

      // Link to the new producer if one was found
      if (newProducerNode) {
        const producerRecord = newProducerNode.get_producers().get(grip);
        if (producerRecord) {
          // If the tap was previously detached (no destinations), re-attach it to its home before connecting
          const homeCtx = newProducerNode.get_context();
          if (homeCtx && !producerRecord.tap.getHomeContext()) {
            producerRecord.tap.onAttach?.(homeCtx);
          }
          producerRecord.addDestinationGrip(node, grip);
          node.setResolvedProvider(grip, newProducerNode);
        }
      } else {
        // If no new producer, ensure it's removed from resolvedProviders
        node.getResolvedProviders().delete(grip);
        // Revert destination drip to default value to maintain deterministic state
        const ctx = node.get_context();
        if (ctx) {
          // Notify the consumer at this destination of the default value
          node.notifyConsumers(grip as any, (grip as any).defaultValue);
        }
      }
    }
  }

  /**
   * Unlinks a consumer from its current producer, if any.
   */
  unresolveConsumer(destNode: GripContextNode, grip: Grip<any>): void {
    const resolvedProviders = destNode.getResolvedProviders();
    const producerNode = resolvedProviders.get(grip);
    if (producerNode) {
      producerNode.removeDestinationForContext(grip, destNode);
      // Only delete from resolvedProviders if the producer was successfully removed
      // This ensures that if the removal fails for some reason, the state is still consistent.
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

    // Add startNode to queue and visited set
    queue.push(startNode);
    visited.add(startNode);

    // 3. BFS search
    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      // Check if current node has the producer
      if (currentNode.get_producers().has(grip)) {
        return currentNode; // Found the closest producer.
      }

      // Enqueue parents for the next level, maintaining root-last order
      // and explicit priority ordering from the context layer.
      const orderedParents = currentNode.get_parents_with_priority();
      const nonRoots: GripContextNode[] = [];
      const roots: GripContextNode[] = [];

      for (const { node: parentNode } of orderedParents) {
        if (!visited.has(parentNode)) {
          if (parentNode.isRoot()) {
            roots.push(parentNode);
          } else {
            nonRoots.push(parentNode);
          }
          visited.add(parentNode); // Mark as visited when enqueued
        }
      }
      queue.push(...nonRoots, ...roots);
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

  // Internal helpers used by Grok's original resolve flow retained for completeness
  resolveConsumerStage1(
    dest: GripContext,
    source: GripContext,
    grip: Grip<any>,
    visited: Set<GripContext>,
    roots: GripContext[],
  ): boolean {
    // This method is tightly coupled with Grok's internal graph traversal.
    // SimpleResolver (this class) is responsible for this logic.
    // Re-implementing the core logic here from Grok's original resolveConsumerStage1
    // Check to see if the current context has a tap that provides this grip.
    var sourceNode = this.grok.ensureNode(source);
    var producer = sourceNode.get_producers().get(grip);

    if (producer) {
      // We have a tap that provides this grip.
      // Link the producer to the original destination context for this grip
      const destNode = this.grok.ensureNode(dest);
      producer.addDestinationGrip(destNode, grip);
      // Record the resolved provider for cleanup from the destination side
      destNode.setResolvedProvider(grip, sourceNode);
      return true;
    }

    // Check all parents all the way up to the root.
    for (const parent of source.getParents()) {
      const parentCtx = parent.ctx;
      if (parentCtx.isRoot()) {
        roots.push(parentCtx);
        continue;
      }
      if (visited.has(parentCtx)) continue;
      visited.add(parentCtx);
      if (this.resolveConsumerStage1(dest, parentCtx, grip, visited, roots)) return true;
    }

    return false;
  }

  resolveProducer(ctx: GripContext, current: GripContext | undefined, grips: Set<Grip<any>>) {
    var available_grips = grips;

    // Check to see local consumers first.
    if (current) {
      const node = this.grok.ensureNode(current);
      const producers = node.get_producers();

      // If there are producers that can provide the grips, then these shadow our
      // grips so we remove them from the available grips. If we're completely
      // overridden, then we return. There may have been other contexts that where
      // we successfully resolved or there may be more grips being registered later
      // where the source context can provide data for.
      if (producers.size > 0) {
        const common = intersection(available_grips, producers.keys());
        if (common.size > 0) {
          available_grips = difference(available_grips, common);
          if (available_grips.size === 0) {
            // The available grips are completely overridden by other producers.
            return;
          }
        }
      }
    } else {
      // On the first call in the recursion we set the current context to be undefined.
      // as we don't want to shadow ourselves. In this case we do want to prodice for
      // local consumers.
      current = ctx;
    }

    // This is where we check for consumers in the "current" destination context.
    const node = this.grok.ensureNode(current);
    // Now scan the children to find any consumers that can be provided by the producers context.
    const consumers = node.get_consumers();
    for (const [grip, drip] of consumers) {
      if (available_grips.has(grip)) {
        // OK - we have a consumer that we want to provide.
        // Now we need to check to see if this context/grip pair is already
        // has a different visible producer by doing a resolveConsumer.
        this.resolveConsumer(node, grip);
      }
    }
  }
}
