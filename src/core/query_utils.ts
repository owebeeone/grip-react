/**
 * Internal record for managing a single partition's state.
 */
type PartitionRecord<T> = {
    items: Set<T>;
    isDirty: boolean;
};

/**
 * A general-purpose, stateful utility to partition items into disjoint sets
 * (collections) based on shared, overlapping properties. This implementation
 * uses direct object references for partitions and supports efficient, incremental
 * addition and removal of items.
 *
 * @template T The type of items to partition.
 * @template K The type of the characteristic used for partitioning (e.g., a Grip or string key).
 */
export class DisjointSetPartitioner<T, K> {
    private partitions = new Set<PartitionRecord<T>>();
    private itemToPartition = new Map<T, PartitionRecord<T>>();
    private characteristicToPartition = new Map<K, PartitionRecord<T>>();
    private itemToCharacteristics = new Map<T, Set<K>>();
    private dirtyPartitions = new Set<PartitionRecord<T>>();

    /**
     * Adds a new item to the partitioner, merging it with existing sets if necessary.
     * @param item The item to add.
     * @param characteristics The set of characteristics for this item.
     */
    public add(item: T, characteristics: K[]): void {
        if (this.itemToPartition.has(item)) {
            return; // Item already exists.
        }

        this.itemToCharacteristics.set(item, new Set(characteristics));

        const partitionsToMerge = new Set<PartitionRecord<T>>();
        for (const char of characteristics) {
            if (this.characteristicToPartition.has(char)) {
                partitionsToMerge.add(this.characteristicToPartition.get(char)!);
            }
        }

        let targetPartition: PartitionRecord<T>;
        if (partitionsToMerge.size === 0) {
            // Create a new partition for this item.
            targetPartition = { items: new Set([item]), isDirty: false };
            this.partitions.add(targetPartition);
        } else {
            // Merge into the first found partition and consolidate others.
            const mergeList = Array.from(partitionsToMerge);
            targetPartition = mergeList[0];
            targetPartition.items.add(item);

            for (let i = 1; i < mergeList.length; i++) {
                const sourcePartition = mergeList[i];
                if (sourcePartition === targetPartition) continue;

                for (const sourceItem of sourcePartition.items) {
                    targetPartition.items.add(sourceItem);
                    this.itemToPartition.set(sourceItem, targetPartition);
                }

                // Update characteristics to point to the new target partition
                for (const sourceItem of sourcePartition.items) {
                    const sourceChars = this.itemToCharacteristics.get(sourceItem);
                    if (sourceChars) {
                        for (const char of sourceChars) {
                            this.characteristicToPartition.set(char, targetPartition);
                        }
                    }
                }

                this.partitions.delete(sourcePartition);
            }
        }

        // Update mappings for the new item and all its characteristics.
        this.itemToPartition.set(item, targetPartition);
        for (const char of characteristics) {
            this.characteristicToPartition.set(char, targetPartition);
        }
    }

    /**
     * Removes an item from the partitioner. This marks the affected partition
     * as "dirty" for delayed re-computation.
     * @param item The item to remove.
     */
    public remove(item: T): void {
        const partition = this.itemToPartition.get(item);
        if (!partition) return;

        // Capture characteristics of the item before we delete its mapping
        const removedCharacteristics = this.itemToCharacteristics.get(item) || new Set<K>();

        partition.items.delete(item);

        // Clean up direct mappings for the item.
        this.itemToPartition.delete(item);
        this.itemToCharacteristics.delete(item);

        // If the partition is now empty, drop it and clean characteristic mappings.
        if (partition.items.size === 0) {
            this.partitions.delete(partition);
            this.dirtyPartitions.delete(partition);

            // Remove any characteristic keys that still point to this (now removed) partition.
            const keysToDelete: K[] = [];
            for (const [char, mappedPartition] of this.characteristicToPartition.entries()) {
                if (mappedPartition === partition) {
                    keysToDelete.push(char);
                }
            }
            for (const char of keysToDelete) {
                this.characteristicToPartition.delete(char);
            }
            return;
        }

        if (partition.items.size >= 2) {
            // Partition may need splitting; defer by marking dirty
            partition.isDirty = true;
            this.dirtyPartitions.add(partition);
        } else {
            // Exactly one item remains: keep partition but remove stale characteristic mappings
            partition.isDirty = false;
            const remainingCharacteristics = new Set<K>();
            for (const remainingItem of partition.items) {
                const chars = this.itemToCharacteristics.get(remainingItem);
                if (chars) {
                    for (const c of chars) remainingCharacteristics.add(c);
                }
            }
            for (const c of removedCharacteristics) {
                if (!remainingCharacteristics.has(c) && this.characteristicToPartition.get(c) === partition) {
                    this.characteristicToPartition.delete(c);
                }
            }
        }
    }

    /**
     * Returns true if there are any dirty partitions.
     */
    public hasDirtyPartitions(): boolean {
        return this.dirtyPartitions.size > 0;
    }

    /**
     * Re-partitions all items from dirty sets. This is called by getPartitions().
     */
    public repartitionDirtySets(): void {
        if (this.dirtyPartitions.size === 0) return;

        const itemsToRepartition = new Set<T>();
        for (const partition of this.dirtyPartitions) {
            partition.items.forEach(item => itemsToRepartition.add(item));

            // Remove all characteristic mappings that point to this partition.
            const keysToDelete: K[] = [];
            for (const [char, mappedPartition] of this.characteristicToPartition.entries()) {
                if (mappedPartition === partition) {
                    keysToDelete.push(char);
                }
            }
            for (const char of keysToDelete) {
                this.characteristicToPartition.delete(char);
            }

            this.partitions.delete(partition);
        }

        // Remove all affected items before re-adding them to rebuild partitions correctly.
        itemsToRepartition.forEach(item => this.itemToPartition.delete(item));

        // Re-add each item. The `add` method will create new, correct partitions.
        for (const item of itemsToRepartition) {
            const characteristics = Array.from(this.itemToCharacteristics.get(item) || []);
            this.add(item, characteristics);
        }

        this.dirtyPartitions.clear();
    }

    /**
     * Returns the current partitions. If any partitions are "dirty" due to removals,
     * it re-computes them before returning the result.
     * @returns An iterable of the disjoint sets.
     */
    public getPartitions(): Iterable<Set<T>> {
        return Array.from(this.partitions).map(p => p.items);
    }
}
