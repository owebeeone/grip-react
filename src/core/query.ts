import type { Grip } from './grip';
import type { Tap } from './tap';

type QueryConditions = ReadonlyMap<Grip<any>, ReadonlyMap<any, number>>;

export class Query {
  /** conditions keyed by Grip identity (only one per Grip) */
  public readonly conditions: QueryConditions;

  constructor(conditions: QueryConditions) {
    this.conditions = conditions;
  }
}

/**
 * QueryBuilder is a fluent builder for Query.
 * It only supports equality and inclusion conditions. Inclusion basically
 * results in multiple query expressions and "or"ed together.
 * 
 * Why the limitation? Performance. The query evaluator is optimized to allow
 * for large numbers of query expressions that evaluate in constant time. If you
 * need more complex conditions, you can provide a function tap the supplies
 * the condition value where is is matched for in the Query.
 */
export interface QueryBuilder {
  oneOf<T>(grip: Grip<T>, value: T, score?: number): QueryBuilder;
  anyOf<T>(
    grip: Grip<T>,
    values: readonly T[],
    score?: number,
  ): QueryBuilder;

  /** finalize */
  build(): Query;
}

class QueryBuilderImpl implements QueryBuilder {
  private conditions = new Map<Grip<any>, Map<any, number>>();
  private isBuilt = false;

  private copyOnWrite(): void {
    if (this.isBuilt) {
      const newConditions = new Map<Grip<any>, Map<any, number>>();
      for (const [grip, valuesMap] of this.conditions.entries()) {
        newConditions.set(grip, new Map(valuesMap));
      }
      this.conditions = newConditions;
      this.isBuilt = false;
    }
  }

  oneOf<T>(grip: Grip<T>, value: T, score?: number): this {
    this.copyOnWrite();
    if (!this.conditions.has(grip)) {
      this.conditions.set(grip, new Map<any, number>());
    }
    const valuesAndScoresMap = this.conditions.get(grip)!;
    valuesAndScoresMap.set(value, score ?? 100);
    return this;
  }

  anyOf<T>(grip: Grip<T>, values: readonly T[], score?: number): this {
    this.copyOnWrite();
    if (!this.conditions.has(grip)) {
      this.conditions.set(grip, new Map<any, number>());
    }
    const valuesAndScoresMap = this.conditions.get(grip)!;
    const scoreToUse = score ?? 100;

    for (const v of values) {
      valuesAndScoresMap.set(v, scoreToUse);
    }

    return this;
  }

  build(): Query {
    this.isBuilt = true;
    return new Query(this.conditions);
  }
}

/** minimal factory to start a builder */
export class QueryBuilderFactory {
  newQuery(): QueryBuilder {
    return new QueryBuilderImpl();
  }
}

/** Helpers */
export const withOneOf = <T>(
  grip: Grip<T>,
  value: T,
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().oneOf(grip, value, score);
};

export const withAnyOf = <T>(
  grip: Grip<T>,
  values: readonly T[],
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().anyOf(grip, values, score);
};
