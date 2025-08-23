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

/**
 * A helper class to manage unique IDs for objects,
 * allowing them to be used in composite keys while respecting reference identity.
 */
class ObjectKeyManager {
    // WeakMap holds the object reference and its unique ID.
    // It won't prevent garbage collection.
    private objectIds: WeakMap<object, number> = new WeakMap();
    private nextId: number = 0;
  
    /**
     * Gets a unique ID for any given object.
     * If the object has been seen before, it returns the existing ID.
     * If it's a new object, it assigns a new ID and stores it.
     * @param {object} obj - The class instance or object.
     * @returns {number} A unique ID for that specific object instance.
     */
    public getId(obj: object): number {
      if (!this.objectIds.has(obj)) {
        this.objectIds.set(obj, this.nextId++);
      }
      // The non-null assertion (!) is safe here because we guarantee the key exists.
      return this.objectIds.get(obj)!;
    }
}

// Create a single instance of the manager to handle all keys.
const keyManager = new ObjectKeyManager();

/**
 * Creates a stable, composite map key from an array of parts.
 * Primitives are compared by value.
 * Objects are compared by reference (identity).
 * @param {Array<any>} parts - An array of numbers, strings, and/or objects.
 * @returns {string} A string key suitable for use in a Map.
 */
export function createCompositeKey(parts: any[]): string {
    return parts
        .map(part => {
            const type = typeof part;
            if (part === null) {
                return 'N:';
            }
            if (type === 'undefined') {
                return 'U:';
            }
            if (type === 'object') {
                const objectId = keyManager.getId(part);
                return `O:${objectId}`;
            }
            if (type === 'string') {
                const str = part as string;
                return `s:${str.length}:${str}`;
            }
            if (type === 'number') {
                const num = part as number;
                const normalized = Number.isNaN(num)
                    ? 'NaN'
                    : Object.is(num, -0)
                    ? '0'
                    : String(num);
                return `n:${normalized}`;
            }
            if (type === 'boolean') {
                return `b:${part ? 'true' : 'false'}`;
            }
            // Fallback for uncommon types (symbol, function): length-prefixed string
            const fallback = String(part);
            return `x:${fallback.length}:${fallback}`;
        })
        .join('|');
}
  
export class TupleMap<K extends any[], V> {

    private internalMap: Map<string, { key: K; value: V }> = new Map();

    public set(key: K, value: V): this {
        this.internalMap.set(createCompositeKey(key), { key, value });
        return this;
    }

    public get(key: K): V | undefined {
        return this.internalMap.get(createCompositeKey(key))?.value;
    }

    public delete(key: K): boolean {
        return this.internalMap.delete(createCompositeKey(key));
    }

    public has(key: K): boolean {
        return this.internalMap.has(createCompositeKey(key));
    }

    public clear(): void {
        this.internalMap.clear();
    }

    public size(): number {
        return this.internalMap.size;
    }

    public *keys(): IterableIterator<K> {
        for (const entry of this.internalMap.values()) {
            yield entry.key;
        }
    }

    public *values(): IterableIterator<V> {
        for (const entry of this.internalMap.values()) {
            yield entry.value;
        }
    }

    public *entries(): IterableIterator<[K, V]> {
        for (const entry of this.internalMap.values()) {
            yield [entry.key, entry.value];
        }
    }

    public forEach(callbackfn: (value: V, key: K, map: this) => void, thisArg?: any): void {
        this.internalMap.forEach((entry, key) => callbackfn.call(thisArg, entry.value, entry.key, this));
    }

    public [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }
}