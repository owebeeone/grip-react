/**
 * @file query_evaluator.ts
 * @description Contains the implementation for the V7 GRIP Query Evaluator.
 * This file includes the core classes for query evaluation, reactive updates,
 * hybrid optimization, and output attribution as specified in the design document.
 */

// ---[ Core GRIP Imports ]-------------------------------------------------------
// These types are imported from the existing GRIP engine's core files.
import { Grip } from "./grip";
import { Query, QueryConditions, QueryMatchScoreMap } from "./query";
import { Tap, TapFactory } from "./tap";
import { DisjointSetPartitioner, TupleMap, createCompositeKey } from "./query_utils";

// ---[ Evaluator-Specific Interfaces ]-------------------------------------------

/**
 * Associates a Query with the Tap it activates and its base score.
 * Each binding must have a unique ID.
 */
export interface QueryBinding {
  id: string; // A unique identifier for this binding
  query: Query;
  tap: Tap | TapFactory;
  baseScore: number;
}

/**
 * The result of adding a new binding to the evaluator.
 */
export interface AddBindingResult {
  /**
   * A set of input Grips that were not known to the evaluator before this binding was added.
   */
  newInputs: Set<Grip<any>>;
  /**
   * A set of input Grips that are no longer used by any query as a result of this binding update.
   * This is only populated when an existing binding is replaced.
   */
  removedInputs: Set<Grip<any>>;
}

/**
 * The result of removing a binding from the evaluator.
 */
export interface RemoveBindingResult {
  /**
   * A set of input Grips that are no longer used by any query after this binding was removed.
   */
  removedInputs: Set<Grip<any>>;
}

/**
 * Represents a matched query result, containing the tap and the calculated score.
 */
export interface MatchedTap {
  tap: Tap | TapFactory;
  score: number;
  bindingId: string;
}

/**
 * The final result of the attribution process for a single Tap,
 * containing all the output grips it has won.
 */
export interface TapAttribution {
  producerTap: Tap | TapFactory;
  score: number;
  bindingId: string;
  attributedGrips: Set<Grip<any>>;
}

/**
 * Represents the change in attributions after an evaluation.
 */
export interface EvaluationDelta {
  added: Map<Tap | TapFactory, TapAttribution>;
  removed: Map<Tap | TapFactory, TapAttribution>; // The old value that was removed
}

export function evaluationToString(delta: EvaluationDelta): string {
  const formatAttribution = (attribution: TapAttribution): string => {
    const tapId =
      (attribution.producerTap as any).id ??
      (attribution.producerTap as any).label ??
      attribution.bindingId ??
      "UnknownTap";
    const grips = Array.from(attribution.attributedGrips)
      .map((g) => g.key)
      .join(", ");
    return `  Tap '${tapId}': [${grips}]`;
  };

  let result = "EvaluationDelta:\n";

  if (delta.added.size > 0) {
    result += ` Added (${delta.added.size}):\n`;
    delta.added.forEach((attr) => {
      result += `${formatAttribution(attr)}\n`;
    });
  }

  if (delta.removed.size > 0) {
    result += ` Removed (${delta.removed.size}):\n`;
    delta.removed.forEach((attr) => {
      result += `${formatAttribution(attr)}\n`;
    });
  }

  if (delta.added.size === 0 && delta.removed.size === 0) {
    result += " No changes.";
  }

  return result;
}

// ---[ Utility Components ]------------------------------------------------------

/**
 * Maps input Grips to the queries that depend on them for efficient reactive updates.
 * This class now supports incremental updates.
 */
export class InvertedIndex {
  private index = new Map<Grip<any>, Set<Query>>();

  /**
   * Adds a query's characteristics to the index.
   * @param query The query to add.
   */
  public add(query: Query): void {
    for (const grip of query.conditions.keys()) {
      if (!this.index.has(grip)) {
        this.index.set(grip, new Set());
      }
      this.index.get(grip)!.add(query);
    }
  }

  /**
   * Removes a query from the index.
   * @param query The query to remove.
   */
  public remove(query: Query): void {
    for (const grip of query.conditions.keys()) {
      const queries = this.index.get(grip);
      if (queries) {
        queries.delete(query);
        if (queries.size === 0) {
          this.index.delete(grip);
        }
      }
    }
  }

  /**
   * Retrieves all queries that are affected by a change in one or more Grips.
   * @param changedGrips A set of Grips that have changed value.
   * @returns A set of unique Queries that need to be re-evaluated.
   */
  public getAffectedQueries(changedGrips: Set<Grip<any>>): Set<Query> {
    const affected = new Set<Query>();
    for (const grip of changedGrips) {
      const queries = this.index.get(grip);
      if (queries) {
        for (const query of queries) {
          affected.add(query);
        }
      }
    }
    return affected;
  }
}

// ---[ Main Evaluator Logic ]----------------------------------------------------

/**
 * A stateless utility to handle attribution logic.
 */
class AttributionUtility {
  public attribute(matches: MatchedTap[]): Map<Tap | TapFactory, TapAttribution> {
    const attributed = new Map<Tap | TapFactory, TapAttribution>();
    const partitioner = new DisjointSetPartitioner<MatchedTap, Grip<any>>();

    for (const match of matches) {
      partitioner.add(match, Array.from(match.tap.provides));
    }

    for (const partition of partitioner.getPartitions()) {
      const sortedTaps = Array.from(partition).sort(
        (a, b) => b.score - a.score || a.bindingId.localeCompare(b.bindingId),
      );
      const seenOutputs = new Set<Grip<any>>();

      for (const matchedTap of sortedTaps) {
        const novelOutputs = Array.from(matchedTap.tap.provides).filter((g) => !seenOutputs.has(g));

        if (novelOutputs.length > 0) {
          const tapAttribution: TapAttribution = {
            producerTap: matchedTap.tap,
            score: matchedTap.score,
            bindingId: matchedTap.bindingId,
            attributedGrips: new Set(novelOutputs),
          };
          attributed.set(matchedTap.tap, tapAttribution);
          novelOutputs.forEach((g) => seenOutputs.add(g));
        }
      }
    }
    return attributed;
  }
}

/**
 * The central query evaluator for the GRIP engine. Now supports incremental
 * addition and removal of query bindings.
 */
export class QueryEvaluator {
  private bindings = new Map<string, QueryBinding>(); // Keyed by binding.id
  private invertedIndex = new InvertedIndex();
  private activeMatches = new Map<string, MatchedTap>(); // Caches the last match result for each binding
  private attributionUtility = new AttributionUtility();
  private inputGripRefCounts = new Map<Grip<any>, number>();
  private lastAttributedResult = new Map<Tap | TapFactory, TapAttribution>();
  private structurallyChangedQueries = new Set<Query>();

  // Caching and evaluation strategy state
  private useHybridEvaluation: boolean;
  private useCache: boolean;
  private queryPartitioner = new DisjointSetPartitioner<Query, Grip<any>>();
  private precomputationThreshold: number;
  private precomputedMaps = new Map<
    Set<Query>,
    TupleMap<any[], Map<Tap | TapFactory, TapAttribution>>
  >();
  private runtimeEvaluationSets = new Set<Set<Query>>();
  private cache = new TupleMap<any[], Map<Tap | TapFactory, TapAttribution>>();
  private queryToPartition = new Map<Query, Set<Query>>();
  private partitionToKeyGrips = new Map<Set<Query>, Grip<any>[]>();

  constructor(
    initialBindings: QueryBinding[] = [],
    precomputationThreshold: number = 1000,
    useHybridEvaluation: boolean = true,
    useCache: boolean = true,
  ) {
    this.precomputationThreshold = precomputationThreshold;
    this.useHybridEvaluation = useHybridEvaluation;
    this.useCache = useCache;
    initialBindings.forEach((b) => this.addBinding(b));
  }

  /**
   * Retrieves a binding by its ID.
   * @param bindingId The ID of the binding to retrieve.
   */
  public getBinding(bindingId: string): QueryBinding | undefined {
    return this.bindings.get(bindingId);
  }

  /**
   * Incrementally adds a new query binding to the evaluator.
   * @param binding The QueryBinding to add.
   * @returns An object containing the set of newly introduced input Grips.
   */
  public addBinding(binding: QueryBinding): AddBindingResult {
    const newInputs = new Set<Grip<any>>();
    let removedInputs = new Set<Grip<any>>();

    if (this.bindings.has(binding.id)) {
      const removeResult = this.removeBinding(binding.id);
      removedInputs = removeResult.removedInputs;
    }

    this.bindings.set(binding.id, binding);
    this.invertedIndex.add(binding.query);
    this.structurallyChangedQueries.add(binding.query);
    this.cache.clear();

    for (const grip of binding.query.conditions.keys()) {
      const currentCount = this.inputGripRefCounts.get(grip) || 0;
      if (currentCount === 0) {
        newInputs.add(grip);
      }
      this.inputGripRefCounts.set(grip, currentCount + 1);
    }

    if (this.useHybridEvaluation) {
      const changedPartitionRecord = this.queryPartitioner.add(
        binding.query,
        Array.from(binding.query.conditions.keys()),
      );
      this.updateHybridStateForPartition(changedPartitionRecord.items);
    }
    return { newInputs, removedInputs };
  }

  /**
   * Incrementally removes a query binding from the evaluator.
   * @param bindingId The ID of the query binding to remove.
   * @returns An object containing the set of input Grips that are no longer used.
   */
  public removeBinding(bindingId: string): RemoveBindingResult {
    const removedInputs = new Set<Grip<any>>();
    const binding = this.bindings.get(bindingId);
    if (binding) {
      this.bindings.delete(bindingId);
      this.invertedIndex.remove(binding.query);
      this.activeMatches.delete(bindingId);
      this.structurallyChangedQueries.add(binding.query);
      this.cache.clear();

      for (const grip of binding.query.conditions.keys()) {
        const currentCount = this.inputGripRefCounts.get(grip);
        if (currentCount) {
          if (currentCount === 1) {
            this.inputGripRefCounts.delete(grip);
            removedInputs.add(grip);
          } else {
            this.inputGripRefCounts.set(grip, currentCount - 1);
          }
        }
      }

      if (this.useHybridEvaluation) {
        const removedFrom = this.queryPartitioner.remove(binding.query);
        if (removedFrom) {
          this.clearHybridStateForPartition(removedFrom.items);
          const newPartitions = this.queryPartitioner.repartitionDirtySets();
          newPartitions.forEach((p) => this.updateHybridStateForPartition(p.items));
        }
      }
    }
    return { removedInputs };
  }

  /**
   * Returns a complete set of all input grips used by any query in the evaluator.
   * @returns A Set of all unique input Grips.
   */
  public getAllInputGrips(): Set<Grip<any>> {
    return new Set(this.inputGripRefCounts.keys());
  }

  private updateHybridStateForPartition(partition: Set<Query>): void {
    this.clearHybridStateForPartition(partition);

    if (this.calculateComplexity(partition) <= this.precomputationThreshold) {
      this.precomputePartition(partition);
    } else {
      this.runtimeEvaluationSets.add(partition);
    }
    partition.forEach((q) => this.queryToPartition.set(q, partition));
  }

  private clearHybridStateForPartition(partition: Set<Query>): void {
    this.precomputedMaps.delete(partition);
    this.runtimeEvaluationSets.delete(partition);
    this.partitionToKeyGrips.delete(partition);
    partition.forEach((q) => this.queryToPartition.delete(q));
  }

  private calculateComplexity(partition: Set<Query>): number {
    const gripValues = new Map<Grip<any>, Set<any>>();
    for (const query of partition) {
      for (const [grip, valuesMap] of query.conditions.entries()) {
        if (!gripValues.has(grip)) gripValues.set(grip, new Set());
        const gripSet = gripValues.get(grip)!;
        for (const value of valuesMap.keys()) {
          gripSet.add(value);
        }
      }
    }
    let complexity = 1;
    for (const values of gripValues.values()) {
      complexity *= values.size;
      if (complexity > this.precomputationThreshold) return complexity; // Early exit
    }
    return complexity;
  }

  private precomputePartition(partition: Set<Query>): void {
    const precomputedMap = new TupleMap<any[], Map<Tap | TapFactory, TapAttribution>>();
    const grips = new Set<Grip<any>>();
    for (const query of partition) {
      query.conditions.forEach((_, grip) => grips.add(grip));
    }

    const gripArray = Array.from(grips).sort((a, b) => a.key.localeCompare(b.key));
    this.partitionToKeyGrips.set(partition, gripArray);

    const allGripValues = new Map<Grip<any>, any[]>();
    for (const grip of gripArray) {
      const values = new Set<any>();
      for (const query of partition) {
        query.conditions.get(grip)?.forEach((_, value) => values.add(value));
      }
      allGripValues.set(grip, Array.from(values));
    }

    const generateCombinations = (index: number, currentCombination: [Grip<any>, any][]) => {
      if (index === gripArray.length) {
        const context = { getValue: (g: Grip<any>) => new Map(currentCombination).get(g) };
        const key = gripArray.map((g) => context.getValue(g));
        const matches = this.evaluateQueries(partition, context);
        const attributed = this.attributionUtility.attribute(Array.from(matches.values()));
        precomputedMap.set(key, attributed);
        return;
      }
      const grip = gripArray[index];
      const values = allGripValues.get(grip) || [undefined];
      for (const value of values) {
        currentCombination.push([grip, value]);
        generateCombinations(index + 1, currentCombination);
        currentCombination.pop();
      }
    };

    generateCombinations(0, []);
    this.precomputedMaps.set(partition, precomputedMap);
  }

  /**
   * Evaluates a set of queries against a given context.
   * @param queries The queries to evaluate.
   * @param context The current GripContext providing values.
   * @returns A map of newly calculated matches, keyed by bindingId.
   */
  private evaluateQueries(queries: Set<Query>, context: any): Map<string, MatchedTap> {
    const newMatches = new Map<string, MatchedTap>();

    const bindingsToEvaluate: QueryBinding[] = [];
    for (const binding of this.bindings.values()) {
      if (queries.has(binding.query)) {
        bindingsToEvaluate.push(binding);
      }
    }

    for (const binding of bindingsToEvaluate) {
      let totalScore = 0;

      if (binding.query.conditions.size === 0) {
        continue;
      }

      let allConditionsMatch = true;
      for (const [grip, valuesAndScoresMap] of binding.query.conditions.entries()) {
        const currentValue = context.getValue(grip);
        if (currentValue === undefined || !valuesAndScoresMap.has(currentValue)) {
          allConditionsMatch = false;
          break;
        }
        totalScore += valuesAndScoresMap.get(currentValue)!;
      }

      if (allConditionsMatch) {
        newMatches.set(binding.id, {
          tap: binding.tap,
          score: binding.baseScore + totalScore,
          bindingId: binding.id,
        });
      }
    }
    return newMatches;
  }

  /**
   * The main entry point for the evaluator, called when Grip values change.
   * @param changedGrips The set of Grips that have new values.
   * @param context The current GripContext.
   * @returns The delta of attributions that have been added or removed.
   */
  public onGripsChanged(changedGrips: Set<Grip<any>>, context: any): EvaluationDelta {
    const queriesToReevaluate = this.invertedIndex.getAffectedQueries(changedGrips);

    for (const query of this.structurallyChangedQueries) {
      queriesToReevaluate.add(query);
    }
    this.structurallyChangedQueries.clear();

    // Update active matches based on the re-evaluated queries
    const newMatches = this.evaluateQueries(queriesToReevaluate, context);
    for (const query of queriesToReevaluate) {
      const associatedBindings = Array.from(this.bindings.values()).filter(
        (b) => b.query === query,
      );
      for (const binding of associatedBindings) {
        const newMatch = newMatches.get(binding.id);
        const oldMatch = this.activeMatches.get(binding.id);

        if (oldMatch && !newMatch) {
          this.activeMatches.delete(binding.id);
        } else if (newMatch) {
          this.activeMatches.set(binding.id, newMatch);
        }
      }
    }

    // Now, run attribution on the complete, updated set of all active matches
    const allActiveMatches = Array.from(this.activeMatches.values());

    let newResult: Map<Tap | TapFactory, TapAttribution>;

    if (this.useCache) {
      const keyGrips = this.getAllInputGrips();
      const key = Array.from(keyGrips)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => context.getValue(g));

      if (this.cache.has(key)) {
        newResult = this.cache.get(key)!;
      } else {
        newResult = this.attributionUtility.attribute(allActiveMatches);
        this.cache.set(key, newResult);
      }
    } else {
      newResult = this.attributionUtility.attribute(allActiveMatches);
    }

    // Calculate the delta
    const added = new Map<Tap | TapFactory, TapAttribution>();
    const removed = new Map<Tap | TapFactory, TapAttribution>();
    const allTaps = new Set([...newResult.keys(), ...this.lastAttributedResult.keys()]);

    for (const tap of allTaps) {
      const newAttr = newResult.get(tap);
      const oldAttr = this.lastAttributedResult.get(tap);

      if (newAttr && !oldAttr) {
        added.set(tap, newAttr);
      } else if (!newAttr && oldAttr) {
        removed.set(tap, oldAttr);
      } else if (newAttr && oldAttr) {
        const newlyWonGrips = new Set<Grip<any>>();
        for (const grip of newAttr.attributedGrips) {
          if (!oldAttr.attributedGrips.has(grip)) {
            newlyWonGrips.add(grip);
          }
        }

        const lostGrips = new Set<Grip<any>>();
        for (const grip of oldAttr.attributedGrips) {
          if (!newAttr.attributedGrips.has(grip)) {
            lostGrips.add(grip);
          }
        }

        if (newlyWonGrips.size > 0) {
          added.set(tap, { ...newAttr, attributedGrips: newlyWonGrips });
        }
        if (lostGrips.size > 0) {
          removed.set(tap, { ...oldAttr, attributedGrips: lostGrips });
        }
      }
    }

    this.lastAttributedResult = newResult;
    return { added, removed };
  }
}
