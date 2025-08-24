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
import { DisjointSetPartitioner } from "./query_utils";

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
 * Represents a matched query result, containing the tap and the calculated score.
 */
export interface MatchedTap {
  tap: Tap | TapFactory;
  score: number;
  bindingId: string;
}

/**
 * The final result of the attribution process for a single output Grip.
 */
export interface AttributedOutput {
  outputGrip: Grip<any>;
  producerTap: Tap | TapFactory;
  score: number;
  bindingId: string;
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
 * Handles the attribution of output Grips to the highest-scoring producer Tap.
 * This engine is now stateful and supports incremental updates.
 */
export class OutputAttributionEngine {
  private partitioner = new DisjointSetPartitioner<MatchedTap, Grip<any>>();
  private activeMatches = new Map<string, MatchedTap>(); // Keyed by bindingId
  private attributedOutputs = new Map<Grip<any>, AttributedOutput>();
  private factoryCache = new WeakMap<TapFactory, Tap>();

  /**
   * Resolves a Tap or TapFactory to a concrete Tap instance, caching factory results.
   */
  private getTap(tapOrFactory: Tap | TapFactory): Tap {
    // Duck-typing to check for TapFactory
    if (typeof (tapOrFactory as any)?.build === 'function') {
      const factory = tapOrFactory as TapFactory;
      if (!this.factoryCache.has(factory)) {
        this.factoryCache.set(factory, factory.build());
      }
      return this.factoryCache.get(factory)!;
    }
    return tapOrFactory as Tap;
  }
  
  private reattributePartitions(partitions: Iterable<{items: Set<MatchedTap>}>): void {
    for (const partition of partitions) {
        // Sort with deterministic tie-breaking
        const sortedTaps = Array.from(partition.items).sort((a, b) => 
            b.score - a.score || a.bindingId.localeCompare(b.bindingId)
        );
        const seenOutputs = new Set<Grip<any>>();

        for (const matchedTap of sortedTaps) {
            const tap = this.getTap(matchedTap.tap);
            const provides = Array.from(tap.provides);
            
            const novelOutputs = provides.filter(grip => !seenOutputs.has(grip));

            if (novelOutputs.length > 0) {
                for (const outputGrip of novelOutputs) {
                    seenOutputs.add(outputGrip);
                    this.attributedOutputs.set(outputGrip, {
                        outputGrip: outputGrip,
                        producerTap: matchedTap.tap,
                        score: matchedTap.score,
                        bindingId: matchedTap.bindingId
                    });
                }
            }
        }
    }
  }

  /**
   * Adds or updates a match and re-evaluates the affected partition.
   * @param match The MatchedTap to add.
   */
  public addMatch(match: MatchedTap): void {
    if (this.activeMatches.has(match.bindingId)) {
      this.removeMatch(match.bindingId);
    }

    this.activeMatches.set(match.bindingId, match);
    const tap = this.getTap(match.tap);
    const changedPartition = this.partitioner.add(match, Array.from(tap.provides));
    
    // Clear old attributions from this partition and re-attribute
    this.clearAttributionsForPartition(changedPartition.items);
    this.reattributePartitions([changedPartition]);
  }

  /**
   * Removes a match by its binding ID and re-evaluates partitions if a split occurred.
   * @param bindingId The ID of the binding whose match should be removed.
   */
  public removeMatch(bindingId: string): void {
    const matchToRemove = this.activeMatches.get(bindingId);
    if (matchToRemove) {
      this.activeMatches.delete(bindingId);
      const removedFromPartition = this.partitioner.remove(matchToRemove);
      
      if (removedFromPartition) {
        this.clearAttributionsForPartition(removedFromPartition.items);
        // After removal, the partition might be dirty (split). Process it now.
        const newPartitions = this.partitioner.repartitionDirtySets();
        if (newPartitions.size > 0) {
            this.reattributePartitions(newPartitions);
        }
      }
    }
  }

  private clearAttributionsForPartition(items: Set<MatchedTap>): void {
      for (const item of items) {
          const tap = this.getTap(item.tap);
          for (const grip of tap.provides) {
              if (this.attributedOutputs.get(grip)?.bindingId === item.bindingId) {
                  this.attributedOutputs.delete(grip);
              }
          }
      }
  }

  /**
   * Returns the current, complete map of attributed outputs.
   */
  public getAttributedOutputs(): Map<Grip<any>, AttributedOutput> {
    return this.attributedOutputs;
  }
}


/**
 * The central query evaluator for the GRIP engine. Now supports incremental
 * addition and removal of query bindings.
 */
export class QueryEvaluator {
  private bindings = new Map<string, QueryBinding>(); // Keyed by binding.id
  private invertedIndex = new InvertedIndex();
  private attributionEngine = new OutputAttributionEngine();
  private activeMatches = new Map<string, MatchedTap>(); // Caches the last match result for each binding

  // Hybrid evaluation state
  private queryPartitioner = new DisjointSetPartitioner<Query, Grip<any>>();
  private precomputationThreshold: number;
  private precomputedMaps = new Map<Query, Map<string, MatchedTap[]>>();
  private runtimeEvaluationSets = new Set<Query>();

  constructor(initialBindings: QueryBinding[] = [], precomputationThreshold: number = 1000) {
    this.precomputationThreshold = precomputationThreshold;
    initialBindings.forEach(b => this.addBinding(b));
  }

  /**
   * Incrementally adds a new query binding to the evaluator.
   * @param binding The QueryBinding to add.
   */
  public addBinding(binding: QueryBinding): void {
    this.bindings.set(binding.id, binding);
    this.invertedIndex.add(binding.query);
    // TODO: Incrementally update hybrid evaluation state
  }

  /**
   * Incrementally removes a query binding from the evaluator.
   * @param bindingId The ID of the query binding to remove.
   */
  public removeBinding(bindingId: string): void {
    const binding = this.bindings.get(bindingId);
    if (binding) {
      this.bindings.delete(bindingId);
      this.invertedIndex.remove(binding.query);
      
      // If this query had an active match, remove it from the attribution engine.
      if (this.activeMatches.has(bindingId)) {
        this.attributionEngine.removeMatch(bindingId);
        this.activeMatches.delete(bindingId);
      }
      // TODO: Incrementally update hybrid evaluation state
    }
  }

  /**
   * Evaluates a set of queries against a given context.
   * @param queries The queries to evaluate.
   * @param context The current GripContext providing values.
   * @returns A map of newly calculated matches, keyed by bindingId.
   */
  private evaluateQueries(queries: Set<Query>, context: any): Map<string, MatchedTap> {
    const newMatches = new Map<string, MatchedTap>();

    // Since a query can have multiple bindings, we need to find all of them.
    const bindingsToEvaluate: QueryBinding[] = [];
    for (const binding of this.bindings.values()) {
        if (queries.has(binding.query)) {
            bindingsToEvaluate.push(binding);
        }
    }

    for (const binding of bindingsToEvaluate) {
      let totalScore = 0;
      let allGripsMatched = true;

      if (binding.query.conditions.size === 0) {
        allGripsMatched = false;
      }

      for (const [grip, valuesAndScoresMap] of binding.query.conditions.entries()) {
        const currentValue = context.getValue(grip);
        if (currentValue === undefined || !valuesAndScoresMap.has(currentValue)) {
          allGripsMatched = false;
          break;
        }
        totalScore += valuesAndScoresMap.get(currentValue)!;
      }

      if (allGripsMatched) {
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
   * @returns The final map of attributed outputs.
   */
  public onGripsChanged(changedGrips: Set<Grip<any>>, context: any): Map<Grip<any>, AttributedOutput> {
    const queriesToReevaluate = this.invertedIndex.getAffectedQueries(changedGrips);
    
    // TODO: Integrate hybrid evaluation logic here.
    
    const newMatches = this.evaluateQueries(queriesToReevaluate, context);

    // Find all bindings associated with the re-evaluated queries
    const bindingsToCheck = new Set<string>();
    for (const binding of this.bindings.values()) {
        if (queriesToReevaluate.has(binding.query)) {
            bindingsToCheck.add(binding.id);
        }
    }

    // Compare new matches with the cached state to update the attribution engine incrementally.
    for (const bindingId of bindingsToCheck) {
      const oldMatch = this.activeMatches.get(bindingId);
      const newMatch = newMatches.get(bindingId);

      if (oldMatch && !newMatch) {
        // Matched before, but not anymore.
        this.attributionEngine.removeMatch(bindingId);
        this.activeMatches.delete(bindingId);
      } else if (!oldMatch && newMatch) {
        // Didn't match before, but does now.
        this.attributionEngine.addMatch(newMatch);
        this.activeMatches.set(bindingId, newMatch);
      } else if (oldMatch && newMatch) {
        // Matched before and still does, but the score or tap might have changed.
        if (oldMatch.score !== newMatch.score || oldMatch.tap !== newMatch.tap) {
          this.attributionEngine.addMatch(newMatch);
          this.activeMatches.set(bindingId, newMatch);
        }
      }
    }
    
    // Get the final result from the updated attribution engine.
    return this.attributionEngine.getAttributedOutputs();
  }
}
