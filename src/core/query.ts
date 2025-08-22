import type { Grip } from './grip';
import type { Tap } from './tap';

// Factories are invoked lazily *only if selected*
export type TapFactory = () => Tap;

// One condition per Grip; op is limited for pre-evaluation friendliness
export type ConditionOp = 'equals' | 'notEquals' | 'in' | 'notIn';

export interface QueryCondition<T = unknown> {
  grip: Grip<T>;
  op: ConditionOp;
  // equals/notEquals => T; in/notIn => T[]
  value: T | readonly T[];
  /** unified priority/score; defaults to 100 */
  score: number;
}

export class Query {
  /** conditions keyed by Grip identity (only one per Grip) */
  public readonly conditions: ReadonlyArray<QueryCondition>;

  constructor(conditions: ReadonlyArray<QueryCondition>) {
    this.conditions = conditions;
  }
}

export interface QueryBuilder {
  equals<T>(grip: Grip<T>, value: T, score?: number): QueryBuilder;
  notEquals<T>(grip: Grip<T>, value: T, score?: number): QueryBuilder;
  in<T>(grip: Grip<T>, values: readonly T[], score?: number): QueryBuilder;
  notIn<T>(grip: Grip<T>, values: readonly T[], score?: number): QueryBuilder;

  /** finalize */
  build(): Query;
}

class QueryBuilderImpl implements QueryBuilder {
  private readonly conditions: QueryCondition[] = [];

  private addCondition<T>(
    grip: Grip<T>,
    op: ConditionOp,
    value: T | readonly T[],
    score?: number,
  ): this {
    const existingIndex = this.conditions.findIndex((c) => c.grip === grip);
    if (existingIndex !== -1) {
      this.conditions.splice(existingIndex, 1);
    }

    this.conditions.push({ grip, op, value, score: score ?? 100 });
    return this;
  }

  equals<T>(grip: Grip<T>, value: T, score?: number): QueryBuilder {
    return this.addCondition(grip, 'equals', value, score);
  }

  notEquals<T>(grip: Grip<T>, value: T, score?: number): QueryBuilder {
    return this.addCondition(grip, 'notEquals', value, score);
  }

  in<T>(grip: Grip<T>, values: readonly T[], score?: number): QueryBuilder {
    return this.addCondition(grip, 'in', values, score);
  }

  notIn<T>(grip: Grip<T>, values: readonly T[], score?: number): QueryBuilder {
    return this.addCondition(grip, 'notIn', values, score);
  }

  build(): Query {
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
export const withEquals = <T>(
  grip: Grip<T>,
  value: T,
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().equals(grip, value, score);
};

export const withNotEquals = <T>(
  grip: Grip<T>,
  value: T,
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().notEquals(grip, value, score);
};

export const withIn = <T>(
  grip: Grip<T>,
  values: readonly T[],
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().in(grip, values, score);
};

export const withNotIn = <T>(
  grip: Grip<T>,
  values: readonly T[],
  score?: number,
): QueryBuilder => {
  return new QueryBuilderFactory().newQuery().notIn(grip, values, score);
};
