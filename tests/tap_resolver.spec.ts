import { describe, it, expect, beforeEach } from 'vitest';
import { Grok } from '../src/core/grok';
import { Grip, GripRegistry } from '../src/core/grip';
import { GripContext } from '../src/core/context';
import { Tap } from '../src/core/tap';
import { SimpleResolver } from '../src/core/tap_resolver';
import { BaseTap } from '../src/core/base_tap';

class MockTap extends BaseTap {
    constructor(provides: Grip<any>[]) {
        super({ provides });
    }
    produce(opts?: { destContext?: GripContext; }): void {
        // no-op
    }
    // Correct implementation for abstract optional methods from BaseTap
    produceOnParams(paramGrip: Grip<any>): void {
        // no-op for tests
    }
    produceOnDestParams(destContext: GripContext | undefined, paramGrip: Grip<any>): void {
        // no-op for tests
    }
}

describe('SimpleResolver', () => {
    let grok: Grok;
    let resolver: SimpleResolver;

    // Grips
    const gripRegistry = new GripRegistry();
    const gripA = gripRegistry.defineGrip<string>('a', 'a');
    const gripM = gripRegistry.defineGrip<string>('m', 'm');
    const gripN = gripRegistry.defineGrip<string>('n', 'n');
    const gripO = gripRegistry.defineGrip<string>('o', 'o');

    beforeEach(() => {
        grok = new Grok(); // Instantiate Grok first (resolver is optional in constructor)
        resolver = new SimpleResolver(grok); // Instantiate SimpleResolver with grok
        (grok as any).resolver = resolver; // Assign the resolver back to grok
        grok.reset(); // Reset the graph and contexts for each test
    });

    const getResolvedContextId = (consumer: GripContext, grip: Grip<any>): string | undefined => {
        const consumerNode = grok.ensureNode(consumer);
        const producerNode = consumerNode.getResolvedProviders().get(grip);
        return producerNode?.get_context()?.id;
    };
    
    const registerProducer = (context: GripContext, tap: Tap) => {
        resolver.addProducer(context, tap);
    };

    const addConsumer = (context: GripContext, grip: Grip<any>) => {
        resolver.addConsumer(context, grip);
    };

    it('Scenario 1: Simple Case', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
    });

    it('Scenario 2: Transitive Case', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        const cc = grok.createContext(cb, 0, 'cc');
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
    });

    it('Scenario 3: Producer Shadowing by Ancestor', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        const cc = grok.createContext(cb, 0, 'cc');
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 4: Priority-Based Resolution', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const cc = grok.createContext(ca, 0, 'cc');
        const cd = grok.createContext(cc, 0, 'cd');
        cd.addParent(cb, 1); // Lower priority
        registerProducer(cb, new MockTap([gripA]));
        registerProducer(cc, new MockTap([gripA]));
        addConsumer(cd, gripA);
        expect(getResolvedContextId(cd, gripA)).toBe(cc.id);
    });
    
    it('Scenario 5: Producer Shadowing by Key', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        const cc = grok.createContext(cb, 0, 'cc');
        registerProducer(ca, new MockTap([gripM, gripN, gripO]));
        registerProducer(cb, new MockTap([gripN]));
        addConsumer(cc, gripN);
        addConsumer(cc, gripO);
        expect(getResolvedContextId(cc, gripN)).toBe(cb.id);
        expect(getResolvedContextId(cc, gripO)).toBe(ca.id);
    });

    it('Scenario 6: Dynamic Re-Parenting', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const cc = grok.createContext(undefined, 0, 'cc');
        cc.addParent(ca, 1);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        cc.addParent(cb, 0); // Add higher-priority parent
        resolver.addParent(cc, cb);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 7: Parent Link Removal & Re-linking', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const cc = grok.createContext(ca, 0, 'cc');
        cc.addParent(cb, 1);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        // Remove the parent link using grok's API (or a simulated equivalent if not directly available)
        // For testing, we can temporarily re-add the parent with a lower priority if it was removed.
        // However, the test scenario is about unlinking, so we call resolver.unlinkParent directly.
        resolver.unlinkParent(cc, ca);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 8: Producer Removal', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const cc = grok.createContext(ca, 0, 'cc');
        cc.addParent(cb, 1);
        const tapA = new MockTap([gripA]);
        registerProducer(ca, tapA);
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        grok.unregisterTap(tapA); // Use the public API for unregistering tap
        // We expect removeProducer to be called internally by unregisterTap or resolver reacts.
        // resolver.removeProducer(ca, tapA); // This is now triggered by unregisterTap
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 9: Adding a Shadowing Producer', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
        const tapB = new MockTap([gripA]);
        registerProducer(cb, tapB);
        resolver.addProducer(cb, tapB);
        expect(getResolvedContextId(cb, gripA)).toBe(cb.id);
    });
    
    it('Scenario 10: No Producer Available', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBeUndefined();
    });

    it('Scenario 11: Consumer in Same Context as Producer', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(ca, gripA);
        expect(getResolvedContextId(ca, gripA)).toBe(ca.id);
    });

    it('Scenario 12: Removing a Consumer', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
        resolver.removeConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBeUndefined();
    });
    
    it('Scenario 13: Fallback to Ancestor After Self-Producer Removal', () => {
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const ca = grok.createContext(cb, 0, 'ca');
        registerProducer(cb, new MockTap([gripA]));
        const tapA = new MockTap([gripA]);
        registerProducer(ca, tapA);
        addConsumer(ca, gripA);
        expect(getResolvedContextId(ca, gripA)).toBe(ca.id);
        grok.unregisterTap(tapA); // Use the public API for unregistering tap
        // resolver.removeProducer(ca, tapA); // This is now triggered by unregisterTap
        expect(getResolvedContextId(ca, gripA)).toBe(cb.id);
    });

    it('Scenario 14: Root Parent De-prioritization', () => {
        const rootCa = grok.rootContext; // $CA
        const cb = grok.createContext(grok.rootContext, 0, 'cb');
        const cd = grok.createContext(rootCa, 0, 'cd');
        cd.addParent(cb, 1);
        registerProducer(rootCa, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cd, gripA);
        // Even though rootCa has priority 0, the non-root cb is checked first.
        expect(getResolvedContextId(cd, gripA)).toBe(cb.id);
    });

    it('Scenario 15: Diamond Dependency Resolution', () => {
        const rootCa = grok.rootContext; // $CA
        const cb = grok.createContext(rootCa, 0, 'cb');
        const cc = grok.createContext(rootCa, 0, 'cc');
        const cd = grok.createContext(cb, 0, 'cd');
        cd.addParent(cc);
        registerProducer(rootCa, new MockTap([gripA]));
        registerProducer(cc, new MockTap([gripA]));
        addConsumer(cd, gripA);
        // The producer in `cc` is found first in the BFS.
        expect(getResolvedContextId(cd, gripA)).toBe(cc.id);
    });

    it('Scenario 16: Cascading Re-linking after Producer Removal', () => {
        const ca = grok.createContext(grok.rootContext, 0, 'ca');
        const cb = grok.createContext(ca, 0, 'cb');
        const cc = grok.createContext(cb, 0, 'cc');
        const cd = grok.createContext(cc, 0, 'cd');
        const tapB = new MockTap([gripA]);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, tapB);
        addConsumer(cc, gripA);
        addConsumer(cd, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
        expect(getResolvedContextId(cd, gripA)).toBe(cb.id);
        grok.unregisterTap(tapB); // Use the public API for unregistering tap
        // resolver.removeProducer(cb, tapB); // This is now triggered by unregisterTap
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        expect(getResolvedContextId(cd, gripA)).toBe(ca.id);
    });
});
