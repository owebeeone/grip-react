import { describe, it, expect, beforeEach } from 'vitest';
import { Grok } from '../src/core/grok';
import { Grip } from '../src/core/grip';
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
}

describe('SimpleResolver', () => {
    let grok: Grok;
    let resolver: SimpleResolver;

    // Grips
    const gripA = new Grip<string>({ name: 'a', defaultValue: 'a' });
    const gripM = new Grip<string>({ name: 'm', defaultValue: 'm' });
    const gripN = new Grip<string>({ name: 'n', defaultValue: 'n' });
    const gripO = new Grip<string>({ name: 'o', defaultValue: 'o' });

    beforeEach(() => {
        grok = new Grok();
        resolver = new SimpleResolver(grok);
        // Replace the default grok resolver with our test instance
        (grok as any).resolver = resolver;
    });

    const getResolvedContextId = (consumer: GripContext, grip: Grip<any>): string | undefined => {
        const consumerNode = grok.ensureNode(consumer);
        const producerNode = consumerNode.getResolvedProviders().get(grip);
        return producerNode?.get_context()?.id;
    };
    
    const registerProducer = (context: GripContext, tap: Tap) => {
        const node = grok.ensureNode(context);
        const record = node.getOrCreateProducerRecord(tap, tap.provides);
        for (const grip of tap.provides) {
            node.producers.set(grip, record);
        }
    };

    const addConsumer = (context: GripContext, grip: Grip<any>) => {
        context.getOrCreateConsumer(grip); // This will trigger the resolver
        resolver.addConsumer(context, grip);
    };

    it('Scenario 1: Simple Case', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
    });

    it('Scenario 2: Transitive Case', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        const cc = grok.createContext(cb);
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
    });

    it('Scenario 3: Producer Shadowing by Ancestor', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        const cc = grok.createContext(cb);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 4: Priority-Based Resolution', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(grok.rootContext);
        const cc = grok.createContext(ca);
        const cd = grok.createContext(cc);
        cd.addParent(cb, 1); // Lower priority
        registerProducer(cb, new MockTap([gripA]));
        registerProducer(cc, new MockTap([gripA]));
        addConsumer(cd, gripA);
        expect(getResolvedContextId(cd, gripA)).toBe(cc.id);
    });
    
    it('Scenario 5: Producer Shadowing by Key', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        const cc = grok.createContext(cb);
        registerProducer(ca, new MockTap([gripM, gripN, gripO]));
        registerProducer(cb, new MockTap([gripN]));
        addConsumer(cc, gripN);
        addConsumer(cc, gripO);
        expect(getResolvedContextId(cc, gripN)).toBe(cb.id);
        expect(getResolvedContextId(cc, gripO)).toBe(ca.id);
    });

    it('Scenario 6: Dynamic Re-Parenting', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(grok.rootContext);
        const cc = grok.createContext();
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
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(grok.rootContext);
        const cc = grok.createContext(ca);
        cc.addParent(cb, 1);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        cc.removeParent(ca);
        resolver.unlinkParent(cc, ca);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 8: Producer Removal', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(grok.rootContext);
        const cc = grok.createContext(ca);
        cc.addParent(cb, 1);
        const tapA = new MockTap([gripA]);
        registerProducer(ca, tapA);
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cc, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        ca.producers.clear(); // Simulate removal
        resolver.removeProducer(ca, tapA);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
    });

    it('Scenario 9: Adding a Shadowing Producer', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
        const tapB = new MockTap([gripA]);
        registerProducer(cb, tapB);
        resolver.addProducer(cb, tapB);
        expect(getResolvedContextId(cb, gripA)).toBe(cb.id);
    });
    
    it('Scenario 10: No Producer Available', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBeUndefined();
    });

    it('Scenario 11: Consumer in Same Context as Producer', () => {
        const ca = grok.createContext(grok.rootContext);
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(ca, gripA);
        expect(getResolvedContextId(ca, gripA)).toBe(ca.id);
    });

    it('Scenario 12: Removing a Consumer', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        registerProducer(ca, new MockTap([gripA]));
        addConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBe(ca.id);
        resolver.removeConsumer(cb, gripA);
        expect(getResolvedContextId(cb, gripA)).toBeUndefined();
    });
    
    it('Scenario 13: Fallback to Ancestor After Self-Producer Removal', () => {
        const cb = grok.createContext(grok.rootContext);
        const ca = grok.createContext(cb);
        registerProducer(cb, new MockTap([gripA]));
        const tapA = new MockTap([gripA]);
        registerProducer(ca, tapA);
        addConsumer(ca, gripA);
        expect(getResolvedContextId(ca, gripA)).toBe(ca.id);
        ca.producers.clear();
        resolver.removeProducer(ca, tapA);
        expect(getResolvedContextId(ca, gripA)).toBe(cb.id);
    });

    it('Scenario 14: Root Parent De-prioritization', () => {
        const rootCa = grok.rootContext; // $CA
        const cb = grok.createContext(grok.rootContext);
        const cd = grok.createContext(rootCa);
        cd.addParent(cb, 1);
        registerProducer(rootCa, new MockTap([gripA]));
        registerProducer(cb, new MockTap([gripA]));
        addConsumer(cd, gripA);
        // Even though rootCa has priority 0, the non-root cb is checked first.
        expect(getResolvedContextId(cd, gripA)).toBe(cb.id);
    });

    it('Scenario 15: Diamond Dependency Resolution', () => {
        const rootCa = grok.rootContext; // $CA
        const cb = grok.createContext(rootCa);
        const cc = grok.createContext(rootCa);
        const cd = grok.createContext(cb);
        cd.addParent(cc);
        registerProducer(rootCa, new MockTap([gripA]));
        registerProducer(cc, new MockTap([gripA]));
        addConsumer(cd, gripA);
        // The producer in `cc` is found first in the BFS.
        expect(getResolvedContextId(cd, gripA)).toBe(cc.id);
    });

    it('Scenario 16: Cascading Re-linking after Producer Removal', () => {
        const ca = grok.createContext(grok.rootContext);
        const cb = grok.createContext(ca);
        const cc = grok.createContext(cb);
        const cd = grok.createContext(cc);
        const tapB = new MockTap([gripA]);
        registerProducer(ca, new MockTap([gripA]));
        registerProducer(cb, tapB);
        addConsumer(cc, gripA);
        addConsumer(cd, gripA);
        expect(getResolvedContextId(cc, gripA)).toBe(cb.id);
        expect(getResolvedContextId(cd, gripA)).toBe(cb.id);
        cb.producers.clear();
        resolver.removeProducer(cb, tapB);
        expect(getResolvedContextId(cc, gripA)).toBe(ca.id);
        expect(getResolvedContextId(cd, gripA)).toBe(ca.id);
    });
});
