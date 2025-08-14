import { Grip } from "./grip";
import type { Grok } from "./grok";
import type { GripContext } from "./context";
import type { GripContextNode, ProducerRecord } from "./graph";
import { Drip } from "./drip";
import { Tap } from "./tap";

// A ContextNode is a node in the graph that represents a context.
// It holds the context state but not the context itself which is public.
// If a GripContext is GC'd, the ContextNode will be cleaned up and
// all dependencies will be cleaned up.
// Lifetime management:
//   References to Drips are weak.
//   Drip references to ContextNodes are hard.
//   References to child ContextNodes are weak.
//   References to ProducerRecords are hard.
//   References to Taps are hard.
//   Tap references to context nodes are hard.
// The basic idea is that the ContextNode is kept alive as long as there are
// active Drips or active Taps or active children ContextNodes.
//
// The ContextNode is not a public API. It is used internally by the engine
// to manage the graph.
export interface GripContextNodeIf {
    get_grok(): Grok;
    get_context(): GripContext | undefined;  // undefined may mean the context has been GC'd
    get_parent_nodes(): GripContextNode[];
    get_children_nodes(): GripContextNode[];
    get_producers(): Map<Grip<any>, ProducerRecord>;
    get_consumers(): Map<Grip<any>, WeakRef<Drip<any>>>;

    addParent(parent: GripContextNode): void;

    recordProducer<T>(grip: Grip<T>, rec: ProducerRecord): void;

    setResolvedProvider<T>(grip: Grip<T>, node: GripContextNode): void;

    // Returns the producer record for a given tap, creating it if it doesn't exist
    getOrCreateProducerRecord(tap: Tap, outputs?: Iterable<Grip<any>>): ProducerRecord;

    // Record a consumer for a given grip.
    recordConsumer<T>(grip: Grip<T>, drip: Drip<T>): void;

    // Returns the live drip instance for this grip at this destination context, if any
    getLiveDripForGrip<T>(grip: Grip<T>): Drip<T> | undefined;

    // Notify the live consumer drip for a grip at this destination context
    notifyConsumers<T>(grip: Grip<T>, value: T): number;

    touch(): void;
    getLastSeen(): number;
}
