/**
 * @file: query_utils.ts
 * @description: Contains utility classes for the GRIP query evaluator.
 */

/**
 * Internal record for managing a single partition's state.
 */
type PartitionRecord<T> = {
    items: Set<T>;
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
     * @returns The partition record that was created or modified.
     */
    public add(item: T, characteristics: K[]): PartitionRecord<T> {
        if (this.itemToPartition.has(item)) {
            return this.itemToPartition.get(item)!;
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
            targetPartition = { items: new Set([item]) };
            this.partitions.add(targetPartition);
        } else {
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
                
                this.updateCharacteristicMappings(sourcePartition, targetPartition);
                this.partitions.delete(sourcePartition);
            }
        }

        this.itemToPartition.set(item, targetPartition);
        for (const char of characteristics) {
            this.characteristicToPartition.set(char, targetPartition);
        }
        
        return targetPartition;
    }

    private updateCharacteristicMappings(from: PartitionRecord<T>, to: PartitionRecord<T>): void {
        for (const sourceItem of from.items) {
            const sourceChars = this.itemToCharacteristics.get(sourceItem);
            if (sourceChars) {
                for (const char of sourceChars) {
                    if (this.characteristicToPartition.get(char) === from) {
                        this.characteristicToPartition.set(char, to);
                    }
                }
            }
        }
    }

    /**
     * Removes an item from the partitioner. This may mark the affected partition
     * as "dirty" if it could have been split.
     * @param item The item to remove.
     * @returns The partition the item was removed from, or null if not found.
     */
    public remove(item: T): PartitionRecord<T> | null {
        const partition = this.itemToPartition.get(item);
        if (!partition) return null;

        partition.items.delete(item);
        this.itemToPartition.delete(item);
        this.itemToCharacteristics.delete(item);

        if (partition.items.size === 0) {
            this.partitions.delete(partition);
            this.dirtyPartitions.delete(partition);
        } else if (partition.items.size >= 2) {
            this.dirtyPartitions.add(partition);
        }
        
        return partition;
    }
    
    /**
     * Retrieves the partition record for a given item.
     * @param item The item to find the partition for.
     * @returns The partition record containing the item, or undefined if not found.
     */
    public getPartitionForItem(item: T): PartitionRecord<T> | undefined {
        return this.itemToPartition.get(item);
    }

    /**
     * Re-partitions all items from dirty sets.
     * @returns A set of newly formed partitions resulting from splits.
     */
    public repartitionDirtySets(): Set<PartitionRecord<T>> {
        if (this.dirtyPartitions.size === 0) return new Set();

        const newPartitions = new Set<PartitionRecord<T>>();
        for (const partition of this.dirtyPartitions) {
            // Clean up old characteristic mappings for all items in the dirty partition
            for (const item of partition.items) {
                const chars = this.itemToCharacteristics.get(item);
                if (chars) {
                    for (const char of chars) {
                        if (this.characteristicToPartition.get(char) === partition) {
                            this.characteristicToPartition.delete(char);
                        }
                    }
                }
            }
            this.partitions.delete(partition);
            
            // Re-add each item, which will form new, correct partitions
            const formed = new Set<PartitionRecord<T>>();
            for (const item of partition.items) {
                this.itemToPartition.delete(item);
                const newPartition = this.add(item, Array.from(this.itemToCharacteristics.get(item) || []));
                formed.add(newPartition);
            }
            // Only report partitions if an actual split occurred
            if (formed.size > 1) {
                for (const p of formed) newPartitions.add(p);
            }
        }

        this.dirtyPartitions.clear();
        return newPartitions;
    }

    /**
     * Returns all current partitions. Note: Does not process dirty sets.
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
