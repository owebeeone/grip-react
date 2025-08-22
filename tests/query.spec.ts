import { describe, it, expect } from 'vitest';

import { GripRegistry } from '../src/core/grip';
import {
  QueryBuilderFactory,
  withEquals,
  withIn,
  withNotEquals,
  withNotIn,
} from '../src/core/query';

const registry = new GripRegistry();
const MODE = registry.defineGrip<string>('mode');
const REGION = registry.defineGrip<string>('region');

describe('QueryBuilder (fluent)', () => {
  const qb = new QueryBuilderFactory();

  it('chains equals/in and builds one-condition-per-grip', () => {
    const q = qb
      .newQuery()
      .equals(MODE, 'live', 5)
      .in(REGION, ['us', 'eu'], 2)
      .build();

    expect(q.conditions).toHaveLength(2);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'equals',
      value: 'live',
      score: 5,
    });
    expect(q.conditions[1]).toMatchObject({
      grip: REGION,
      op: 'in',
      value: ['us', 'eu'],
      score: 2,
    });
  });

  it('supports notEquals/notIn', () => {
    const q = qb
      .newQuery()
      .notEquals(MODE, 'sim', 1)
      .notIn(REGION, ['cn'], 1)
      .build();

    expect(q.conditions.map((c) => c.op)).toEqual(['notEquals', 'notIn']);
  });

  it('overwrites condition for the same grip', () => {
    const q = qb
      .newQuery()
      .equals(MODE, 'live', 5)
      .equals(MODE, 'sim', 3)
      .build();

    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'equals',
      value: 'sim',
      score: 3,
    });
  });

  it('defaults score to 100 when not provided', () => {
    const q = qb.newQuery().equals(MODE, 'live').build();

    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'equals',
      value: 'live',
      score: 100,
    });
  });

  it('uses a score of 0 when provided', () => {
    const q = qb.newQuery().equals(MODE, 'live', 0).build();

    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'equals',
      value: 'live',
      score: 0,
    });
  });
});

describe('Query helpers', () => {
  it('withEquals creates a query with an equals condition', () => {
    const q = withEquals(MODE, 'live', 5).build();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'equals',
      value: 'live',
      score: 5,
    });
  });

  it('withNotEquals creates a query with a notEquals condition', () => {
    const q = withNotEquals(MODE, 'sim', 1).build();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: MODE,
      op: 'notEquals',
      value: 'sim',
      score: 1,
    });
  });

  it('withIn creates a query with an in condition', () => {
    const q = withIn(REGION, ['us', 'eu'], 2).build();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: REGION,
      op: 'in',
      value: ['us', 'eu'],
      score: 2,
    });
  });

  it('withNotIn creates a query with a notIn condition', () => {
    const q = withNotIn(REGION, ['cn'], 1).build();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0]).toMatchObject({
      grip: REGION,
      op: 'notIn',
      value: ['cn'],
      score: 1,
    });
  });
});
