/**
 * @file: query_utils.spec.ts
 * @description: Unit tests for the DisjointSetPartitioner utility.
 */

import { describe, it, expect } from 'vitest';
import { DisjointSetPartitioner } from '../src/core/query_utils';

// Normalization utilities to compare partitions with Vitest's native diff, ignoring order.
function normalizePartitions<T extends { id: string }>(partitions: Iterable<Set<T>>): T[][] {
    const compareItems = (a: T, b: T) => a.id.localeCompare(b.id);
    const compareSets = (a: T[], b: T[]) => {
        if (a.length === 0 || b.length === 0) return a.length - b.length;
        return a[0].id.localeCompare(b[0].id);
    };
    return Array.from(partitions)
        .map(s => Array.from(s).sort(compareItems))
        .sort(compareSets);
}

function normalizeArrays<T extends { id: string }>(expected: T[][]): T[][] {
    const compareItems = (a: T, b: T) => a.id.localeCompare(b.id);
    const compareSets = (a: T[], b: T[]) => {
        if (a.length === 0 || b.length === 0) return a.length - b.length;
        return a[0].id.localeCompare(b[0].id);
    };
    return expected
        .map(arr => [...arr].sort(compareItems))
        .sort(compareSets);
}


describe('DisjointSetPartitioner', () => {

    // Mock items for testing. Using simple objects with an ID.
    const itemA = { id: 'A' };
    const itemB = { id: 'B' };
    const itemC = { id: 'C' };
    const itemD = { id: 'D' };
    const itemE = { id: 'E' };
    const itemF = { id: 'F' };

    it('should place items with no shared characteristics into separate partitions', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.add(itemB, ['blue']);
        partitioner.add(itemC, ['green']);

        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA], [itemB], [itemC]]));
    });

    it('should place items with shared characteristics into the same partition', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red', 'circle']);
        partitioner.add(itemB, ['blue', 'square']);
        partitioner.add(itemC, ['green', 'circle']);

        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA, itemC], [itemB]]));
    });

    it('should merge partitions when a new item bridges them', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.add(itemB, ['blue']);
        
        // Before bridging, they are separate
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA], [itemB]]));

        // Add itemC that shares characteristics with both A and B
        partitioner.add(itemC, ['red', 'blue']);

        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA, itemB, itemC]]));
    });

    it('should handle removal of an item that does not split a partition', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.add(itemB, ['red']);
        partitioner.add(itemC, ['red']);

        partitioner.remove(itemB);

        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA, itemC]]));
    });

    it('should handle removal of an item that splits a partition', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.add(itemB, ['blue']);
        partitioner.add(itemC, ['red', 'blue']); // C is the bridge

        // All are in one partition initially
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA, itemB, itemC]]));

        // Removing the bridge should split the partition
        partitioner.remove(itemC);
        partitioner.repartitionDirtySets();

        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA], [itemB]]));
    });
    
    it('should handle complex splitting and merging', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['1', '2']);
        partitioner.add(itemB, ['2', '3']);
        partitioner.add(itemC, ['3', '4']);
        partitioner.add(itemD, ['5', '6']);
        partitioner.add(itemE, ['6', '7']);
        
        // We expect two partitions: {A, B, C} and {D, E}
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA, itemB, itemC], [itemD, itemE]]));

        // Remove the central link in the first partition
        partitioner.remove(itemB);
        partitioner.repartitionDirtySets();
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA], [itemC], [itemD, itemE]]));

        // Add a new item F that links A and D
        partitioner.add(itemF, ['1', '5']);
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA, itemD, itemE, itemF], [itemC]]));
    });

    it('should correctly re-partition after multiple removals', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['1']);
        partitioner.add(itemB, ['1', '2']);
        partitioner.add(itemC, ['2', '3']);
        partitioner.add(itemD, ['3']);

        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA, itemB, itemC, itemD]]));

        // Removing the two middle items should leave A and D separate
        partitioner.remove(itemB);
        partitioner.remove(itemC);
        
        // If the partitioner is dirty it will return the partitions that 
        // the remaining items are in.
        const partitions = partitioner.getPartitions();
        expect(normalizePartitions(partitions)).toEqual(normalizeArrays([[itemA, itemD]]));

        partitioner.repartitionDirtySets();
        const partitions2 = partitioner.getPartitions();
        expect(normalizePartitions(partitions2)).toEqual(normalizeArrays([[itemA], [itemD]]));
    });

    it('should do nothing when removing an item that does not exist', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.remove(itemB); // itemB was never added
        partitioner.repartitionDirtySets();
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemA]]));
    });
    
    it('should handle removing the last item from a partition', () => {
        const partitioner = new DisjointSetPartitioner<{ id: string }, string>();
        partitioner.add(itemA, ['red']);
        partitioner.add(itemB, ['blue']);
        
        partitioner.remove(itemA);
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemB]]));
        partitioner.repartitionDirtySets();
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([[itemB]]));
        
        partitioner.remove(itemB);
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([]));
        partitioner.repartitionDirtySets();
        expect(normalizePartitions(partitioner.getPartitions())).toEqual(normalizeArrays([]));
    });
});
