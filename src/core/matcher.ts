/**
 * @file matcher.ts
 * @description Implements the TapMatcher which uses a QueryEvaluator to
 * dynamically select and attribute taps based on context.
 */

// ---[ Core GRIP Imports ]-------------------------------------------------------
import { Grip } from "./grip";
import { Drip, Unsubscribe } from "./drip";
import { Tap, TapFactory } from "./tap";
import { DualContextContainer } from "./containers";
import { GripContext } from "./context";
import {
  QueryEvaluator,
  QueryBinding,
  EvaluationDelta,
  AddBindingResult,
  RemoveBindingResult,
} from "./query_evaluator";

/**
 * The TapMatcher is responsible for observing a 'home' context for input grip changes,
 * evaluating queries against those inputs, and determining which taps should be active
 * in a 'presentation' context.
 */
export class TapMatcher {
  private evaluator: QueryEvaluator;
  private container: DualContextContainer;
  private valuesMap = new Map<Grip<any>, any>();
  private changedGrips = new Set<Grip<any>>();
  private dripSubscriptions = new Map<Grip<any>, Unsubscribe>();
  private isFirstEvaluation = true;

  /**
   * Constructs a TapMatcher instance.
   * @param container A DualContextContainer providing the 'home' context for inputs
   * and the 'presentation' context for outputs.
   */
  constructor(container: DualContextContainer) {
    this.container = container;
    this.evaluator = new QueryEvaluator();
  }

  /**
   * Adds a query binding to the matcher and subscribes to necessary input grips.
   * @param binding The QueryBinding to add.
   */
  public addBinding(binding: QueryBinding): void {
    const result: AddBindingResult = this.evaluator.addBinding(binding);
    result.newInputs.forEach(grip => this._subscribeToGrip(grip));
    result.removedInputs.forEach(grip => this._unsubscribeFromGrip(grip));
  }

  /**
   * Removes a query binding from the matcher and cleans up subscriptions.
   * @param bindingId The ID of the binding to remove.
   */
  public removeBinding(bindingId: string): void {
    const result: RemoveBindingResult = this.evaluator.removeBinding(bindingId);
    result.removedInputs.forEach(grip => this._unsubscribeFromGrip(grip));
  }

  /**
   * Subscribes to a grip in the home context.
   * @param grip The grip to subscribe to.
   */
  private _subscribeToGrip(grip: Grip<any>): void {
    if (this.dripSubscriptions.has(grip)) {
      return;
    }

    const homeCtx = this.container.getGripHomeContext();
    const drip = homeCtx.getOrCreateConsumer(grip);

    // For the very first evaluation, we need to get the initial value.
    if (this.isFirstEvaluation) {
        this.valuesMap.set(grip, drip.get());
        this.changedGrips.add(grip);
    }

    const unsubscribe = drip.subscribePriority(() => {
      this._onGripChanged(grip, drip);
    });

    this.dripSubscriptions.set(grip, unsubscribe);
  }

  /**
   * Unsubscribes from a grip.
   * @param grip The grip to unsubscribe from.
   */
  private _unsubscribeFromGrip(grip: Grip<any>): void {
    const unsubscribe = this.dripSubscriptions.get(grip);
    if (unsubscribe) {
      unsubscribe();
      this.dripSubscriptions.delete(grip);
      this.valuesMap.delete(grip);
    }
  }

  /**
   * Handles a change notification from a subscribed drip.
   * @param grip The grip that changed.
   * @param drip The drip instance for the changed grip.
   */
  private _onGripChanged(grip: Grip<any>, drip: Drip<any>): void {
    this.valuesMap.set(grip, drip.get());
    this.changedGrips.add(grip);
    // Schedule the evaluation to run in a low-priority task
    this.container.getGripHomeContext().submitTask(() => this._evaluate(), 100);
  }

  /**
   * Executes the query evaluator with the collected changes.
   */
  private _evaluate(): void {
    if (this.changedGrips.size === 0 && !this.isFirstEvaluation) {
      return;
    }

    const gripsToEvaluate = this.changedGrips;
    this.changedGrips = new Set<Grip<any>>();
    this.isFirstEvaluation = false;

    const contextSnapshot = {
      getValue: (grip: Grip<any>) => this.valuesMap.get(grip),
    };

    const delta = this.evaluator.onGripsChanged(
      gripsToEvaluate,
      contextSnapshot
    );

    this.applyAttributionDelta(delta);
  }

  /**
   * Applies the calculated delta of tap attributions to the presentation context.
   * This is where taps would be registered or unregistered.
   * @param delta The evaluation delta containing added and removed tap attributions.
   */
  public applyAttributionDelta(delta: EvaluationDelta): void {
    // TODO: Implement the logic to add/remove taps from the presentation context
    // based on the contents of delta.added and delta.removed.
    // This will involve updating the GripContextNode's producer records.
    console.log("Applying attribution delta:", delta);
  }
}
