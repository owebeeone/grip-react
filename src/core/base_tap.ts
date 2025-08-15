import { Drip, Unsubscribe } from "./drip";
import { Grip } from "./grip";
import type { GripContext } from "./context";
import type { GripContextLike } from "./containers";
import type { Grok } from "./grok";
import type { Tap } from "./tap";
import type { GripContextNode, Destination, ProducerRecord } from "./graph";

// Base implementation that manages lifecycle and home/destination bookkeeping
export abstract class BaseTap implements Tap {
  protected engine?: Grok;
  readonly provides: readonly Grip<any>[];  // Grips this tap publishes.
  readonly destinationParamGrips?: readonly Grip<any>[];  // Grips this tap reads from the destination context.
  readonly homeParamGrips?: readonly Grip<any>[];  // Grips this tap reads from the paramsContext.
  protected homeContext?: GripContext;   // The context that this tap publishes to.
  protected paramsContext?: GripContext;  // The context that provides incoming parameters.
  protected paramDrips: Map<Grip<any>, Drip<any>> = new Map();
  protected paramDripsSubs: Map<Grip<any>, Unsubscribe> = new Map();
  protected producer?: ProducerRecord;
  protected delayedUpdates: boolean = true;
  protected paramUpdates: Set<Grip<any>> = new Set();

  constructor(opts: {
    provides: readonly Grip<any>[];
    destinationParamGrips?: readonly Grip<any>[];
    homeParamGrips?: readonly Grip<any>[];
  }) {
    this.provides = opts.provides;
    this.destinationParamGrips = opts.destinationParamGrips;
    this.homeParamGrips = opts.homeParamGrips;

    // Make sure that none of the destinationParamGrips are in the provides.
    // We can't produce what we consume.
    if (opts.destinationParamGrips) {
      for (const grip of opts.destinationParamGrips) {
        if (this.provides.includes(grip)) {
          throw new Error("Destination parameter grip is also provided by this tap");
        }
      }
    }

  }

  // Called when the tap is attached to a home context.
  onAttach(home: GripContext | GripContextLike): void {
    var realHome : GripContext;
    var paramContext : GripContext;
    if ((home as any).getGripHomeContext) {
      const contextLike = home as GripContextLike;
      realHome = contextLike.getGripHomeContext();
      paramContext = contextLike.getGripConsumerContext();
    } else {
      realHome = home as GripContext;
      paramContext = realHome;
    }
    this.homeContext = realHome;
    this.paramsContext = paramContext;
    // Ensure a ProducerRecord exists for this tap at the home node
    this.producer = this.homeContext
      ._getContextNode()
      .getOrCreateProducerRecord(this as unknown as Tap, this.provides);

    // Discover engine from context (engine ensures this linkage)
    const grok: Grok = realHome.getGrok();
    this.engine = grok;

    this.subscribeToIncomingParamss();
  }

  // Subscribe to the incoming parameter drips.
  private subscribeToIncomingParamss(): void {
    if (!this.paramsContext || !this.destinationParamGrips) return;

    this.delayedUpdates = true;  // Delay updates while we subscribe to the incoming parameter drips.
    const self = this;

    // Subscribe to all the incoming parameter drips.
    for (const paramGrip of this.destinationParamGrips) {
      const paramDrip = this.paramsContext.getOrCreateConsumer(paramGrip);
      const sub = paramDrip.subscribe((v) => {
        self.inputParmsChanged(paramGrip);
      });
      this.paramDrips.set(paramGrip, paramDrip);
      this.paramDripsSubs.set(paramGrip, sub);
    }
  }

  inputParmsChanged(paramGrip: Grip<any>): void {
    this.paramUpdates.add(paramGrip);
    if (!this.delayedUpdates) {
      this.produceOnParams!(paramGrip);
    }
  }

  onDetach(): void {
    this.engine = undefined;
    this.homeContext = undefined;
  }

  getDestinationsForNode(node: GripContextNode, grip: Grip<any>): Destination | undefined {
    // Get the ProducerRecord for this grip.
    const producer = node.get_producers().get(grip);
    if (!producer) throw new Error("Grip not produced by this tap");

    // Get the destinations record for this producer.
    const destination = producer.getDestinations().get(node);
    return destination;
  }


  onConnect(dest: GripContext, grip: Grip<any>): void {
    // If we have destinationParamGrips, we need to connect to them.
    if (this.destinationParamGrips) {
      // Get the destination context node.
      const homeContext = this.homeContext;
      if (!homeContext) throw new Error("Tap not attached to a home context");
      const homeNode = homeContext._getContextNode();
      if (!homeNode) throw new Error("Home context has no node");

      // Get the destinations record for this producer.
      const destination = this.producer?.getDestinations().get(dest._getContextNode());
      if (!destination) throw new Error("Destination not found for this tap");

      for (const paramGrip of this.destinationParamGrips) {
        const paramDrip = dest.getOrCreateConsumer(paramGrip);
        // subscription wiring handled by Destination; no-op here for now 
        ?????// TODO: Implement this.
      }
      // Produce initial values for this destination on first connect
      this.produce({ destContext: dest });
    }
  }

  onDisconnect(dest: GripContext, grip: Grip<any>): void {
    const destination = this.getDestination(dest);
    if (!destination) throw new Error("Destination not found for this tap");
    destination.removeGrip(grip);
    if (destination.getGrips().size === 0) {
      // There are no grips being provided to this destination.
      // Remove the destination from the producer.
      destination.unregisterDestination();
    }
  }

  getDestination(dest: GripContext): Destination | undefined {
    return this.producer?.getDestinations().get(dest._getContextNode());
  }

  // This will publish the updates to a single destination or all destinations.
  // If this tap has destinationParamGrips, then it's assumed that each destination
  // will have a different set of updates, however, it's up to the tap implementation
  // to determine which updates to publish to which destination.
  protected publish(updates: Map<Grip<any>, any>, target?: GripContext): number {
    if (!this.engine || !this.homeContext) throw new Error("Tap not attached to a home context");
    
    var destinations: Destination[] = [];
    if (target) {
      const destination = this.getDestination(target);
      if (!destination) throw new Error("Destination not found for this tap");
      destinations.push(destination);
    } else {
      destinations = Array.from(this.producer?.getDestinations().values() ?? []);
    }

    var count = 0;
    for (const destination of destinations) {
      const destCtx = destination.getContext();
      if (!destCtx) continue;
      for (const grip of destination.getGrips()) {
        if (updates.has(grip)) {
          count += destCtx._getContextNode().notifyConsumers(grip, updates.get(grip));
        }
      }
    }
    return count;
  }

  // Produce for the current state. If destContext is provided, then only
  // provide the updates for the destination context provided.
  abstract produce(opts?: {destContext?: GripContext}): void;

  // A grip on an input parameter has changed.
  abstract produceOnParams?(paramGrip: Grip<any>): void;

  // A grip on a destination parameter has changed.
  abstract produceOnDestParams?(destContext: GripContext | undefined, paramGrip: Grip<any>): void;
}


/**
 * Base tap that doesn't have any parameters.
 */
export abstract class BaseTapNoParams extends BaseTap {

  constructor(opts: {
    provides: readonly Grip<any>[];
  }) {
    super({provides: opts.provides});
  }
  
  // Produce for the current state. If destContext is provided, then only
  // provide the updates for the destination context provided.
  abstract produce(opts?: {destContext?: GripContext}): void;

  produceOnParams?(paramGrip: Grip<any>): void {
    throw new Error("Method not implemented.");
  }
  produceOnDestParams?(destContext: GripContext | undefined, paramGrip: Grip<any>): void {
    throw new Error("Method not implemented.");
  }
}