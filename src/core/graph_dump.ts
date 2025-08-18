import { Grok } from "./grok";
import { Grip } from "./grip";
import { Drip } from "./drip";
import type { Tap } from "./tap";
import { GripContext } from "./context";
import { GripContextNode, ProducerRecord } from "./graph";

export interface GraphDumpSummary {
	contextCount: number;
	tapCount: number;
	dripCount: number;
}

export interface GraphDumpNodeContext {
	key: string;
	type: "Context";
	label?: string;
	children: string[];
	taps: string[];
	metadata?: Record<string, unknown>;
	gcStatus?: "live" | "collected" | "unknown";
}

export interface GraphDumpNodeTap {
	key: string;
	type: "Tap";
	class: string;
	providesGrips: string[];
	publisherContext: string;
	outgoingDrips: string[];
	destinationContexts: string[];
	incomingHomeParamDrips?: string[];
	incomingDestParamDrips?: string[];
	state?: Record<string, unknown>;
}

export interface GraphDumpNodeDrip {
	key: string;
	type: "Drip";
	grip: string;
	providerTap?: string;
	destContext: string;
	valuePreview?: unknown;
}

export interface GraphDump {
	timestampIso: string;
	summary: GraphDumpSummary;
	nodes: {
		contexts: GraphDumpNodeContext[];
		taps: GraphDumpNodeTap[];
		drips: GraphDumpNodeDrip[];
	};
}

export interface GraphDumpOptions {
	includeValues?: boolean;
	maxValueLength?: number;
}

/**
 * Stable key registry using WeakMap so we never inhibit GC.
 */
export class GraphDumpKeyRegistry {
	private contextSeq = 1;
	private tapSeq = 1;
	private dripSeq = 1;

	private readonly contextToKey = new WeakMap<GripContextNode, string>();
	private readonly tapToKey = new WeakMap<Tap, string>();
	private readonly dripToKey = new WeakMap<Drip<any>, string>();

	getContextKey(node: GripContextNode): string {
		const existing = this.contextToKey.get(node);
		if (existing) return existing;
		const k = `kCtxt${this.contextSeq++}`;
		this.contextToKey.set(node, k);
		return k;
	}

	getTapKey(tap: Tap): string {
		const existing = this.tapToKey.get(tap);
		if (existing) return existing;
		const k = `kTap${this.tapSeq++}`;
		this.tapToKey.set(tap, k);
		return k;
	}

	getDripKey(drip: Drip<any>): string {
		const existing = this.dripToKey.get(drip);
		if (existing) return existing;
		const k = `kDrip${this.dripSeq++}`;
		this.dripToKey.set(drip, k);
		return k;
	}
}

/**
 * Compose a read-only JSON dump of the current graph.
 * This class is React-agnostic and does not mutate any engine state.
 */
export class GripGraphDumper {
	private readonly grok: Grok;
	private readonly keys: GraphDumpKeyRegistry;
	private readonly opts: Required<GraphDumpOptions>;

	constructor(args: { grok: Grok; keys?: GraphDumpKeyRegistry; opts?: GraphDumpOptions }) {
		this.grok = args.grok;
		this.keys = args.keys ?? new GraphDumpKeyRegistry();
		this.opts = {
			includeValues: args.opts?.includeValues ?? true,
			maxValueLength: args.opts?.maxValueLength ?? 200,
		};
	}

	dump(): GraphDump {
		const timestampIso = new Date().toISOString();
		const contexts: GraphDumpNodeContext[] = [];
		const taps: GraphDumpNodeTap[] = [];
		const drips: GraphDumpNodeDrip[] = [];

		// Dedup containers
		const seenTaps = new Set<Tap>();
		const seenDrips = new Set<Drip<any>>();

		// Iterate graph snapshot
		const graph = this.grok.getGraph();
		for (const node of graph.values()) {
			contexts.push(this.buildContextNode(node));
			// Collect taps attached at this context
			for (const [tap, rec] of node.producerByTap) {
				if (!seenTaps.has(tap)) {
					taps.push(this.buildTapNode(node, tap, rec, seenDrips, drips));
					seenTaps.add(tap);
				}
			}
			// Collect consumer drips at this destination context
			for (const [grip, wr] of node.get_consumers()) {
				const d = wr.deref();
				if (!d) continue;
				if (seenDrips.has(d)) continue;
				drips.push(this.buildDripNode(node, grip as Grip<any>, d));
				seenDrips.add(d);
			}
		}

		const summary: GraphDumpSummary = {
			contextCount: contexts.length,
			tapCount: taps.length,
			dripCount: drips.length,
		};
		return { timestampIso, summary, nodes: { contexts, taps, drips } };
	}

	private buildContextNode(node: GripContextNode): GraphDumpNodeContext {
		const key = this.keys.getContextKey(node);
		const ctx = node.get_context();
		const gcStatus = this.computeGcStatus(ctx);
		const children = node.get_children_nodes().map((c) => this.keys.getContextKey(c));
		const taps = Array.from(node.producerByTap.keys()).map((t) => this.keys.getTapKey(t));
		const isRoot = node.get_parent_nodes().length === 0;
		return {
			key,
			type: "Context",
			label: ctx?.id ?? node.id,
			children,
			taps,
			metadata: { id: node.id, isRoot },
			gcStatus,
		};
	}

	private buildTapNode(
		homeNode: GripContextNode,
		tap: Tap,
		rec: ProducerRecord,
		seenDrips: Set<Drip<any>>,
		dripsOut: GraphDumpNodeDrip[]
	): GraphDumpNodeTap {
		const key = this.keys.getTapKey(tap);
		const className = (tap as any)?.constructor?.name ?? "Tap";
		const providesGrips = (tap.provides ?? []).map((g) => this.describeGrip(g));
		const publisherContext = this.keys.getContextKey(homeNode);

		const outgoingDripKeys: string[] = [];
		const destinationContexts: string[] = [];
		const incomingDestParamDrips: string[] = [];
		const incomingHomeParamDrips: string[] = [];

		// Enumerate destinations and produced drips
		for (const [destNode, destination] of rec.getDestinations()) {
			destinationContexts.push(this.keys.getContextKey(destNode));
			// Outgoing drips: per grip at this destination locate the consumer drip
			for (const g of destination.getGrips()) {
				const wr = destNode.get_consumers().get(g as unknown as Grip<any>);
				const d = wr?.deref();
				if (!d) continue;
				outgoingDripKeys.push(this.keys.getDripKey(d));
				if (!seenDrips.has(d)) {
					dripsOut.push(this.buildDripNode(destNode, g as Grip<any>, d));
					seenDrips.add(d);
				}
			}
			// Incoming destination parameter drips (if param grips are declared)
			const paramGrips = tap.destinationParamGrips ?? [];
			for (const pg of paramGrips) {
				const wrp = destNode.get_consumers().get(pg as unknown as Grip<any>);
				const pd = wrp?.deref();
				if (!pd) continue;
				incomingDestParamDrips.push(this.keys.getDripKey(pd));
			}
		}

		// Home parameter drips (best-effort: look at homeNode consumers for declared grips)
		const homeParamGrips = tap.homeParamGrips ?? [];
		for (const hg of homeParamGrips) {
			const wrh = homeNode.get_consumers().get(hg as unknown as Grip<any>);
			const hd = wrh?.deref();
			if (!hd) continue;
			incomingHomeParamDrips.push(this.keys.getDripKey(hd));
		}

		const state = this.extractTapState(tap);
		return {
			key,
			type: "Tap",
			class: className,
			providesGrips,
			publisherContext,
			outgoingDrips: outgoingDripKeys,
			destinationContexts,
			incomingHomeParamDrips: incomingHomeParamDrips.length ? incomingHomeParamDrips : undefined,
			incomingDestParamDrips: incomingDestParamDrips.length ? incomingDestParamDrips : undefined,
			state,
		};
	}

	private extractTapState(tap: Tap): Record<string, unknown> | undefined {
		// Best-effort: if the tap exposes a get() method (e.g., SimpleValueTap), surface its value.
		try {
			const anyTap = tap as any;
			if (typeof anyTap.get === "function") {
				const v = anyTap.get();
				if (v === undefined) return undefined;
				return { simpleValue: this.previewValue(v) };
			}
		} catch {}
		return undefined;
	}

	private buildDripNode(destNode: GripContextNode, grip: Grip<any>, drip: Drip<any>): GraphDumpNodeDrip {
		const key = this.keys.getDripKey(drip);
		const destContext = this.keys.getContextKey(destNode);
		const providerTapKey = this.findProviderTapKey(destNode, grip);
		const valuePreview = this.opts.includeValues ? this.previewValue(drip.get()) : undefined;
		return {
			key,
			type: "Drip",
			grip: this.describeGrip(grip),
			providerTap: providerTapKey,
			destContext,
			valuePreview,
		};
	}

	private findProviderTapKey(destNode: GripContextNode, grip: Grip<any>): string | undefined {
		const providerNode = destNode.getResolvedProviders().get(grip as unknown as Grip<any>);
		if (!providerNode) return undefined;
		const rec = providerNode.get_producers().get(grip as unknown as Grip<any>);
		const tap = rec?.tap;
		return tap ? this.keys.getTapKey(tap) : undefined;
	}

	private describeGrip(g: Grip<any>): string {
		// Prefer a friendly form, fall back to key
		const label = g.name ?? g.key;
		return `Grip(${label})`;
	}

	private previewValue(v: unknown): unknown {
		if (v == null) return v;
		try {
			const s = typeof v === "string" ? v : JSON.stringify(v);
			if (s.length > this.opts.maxValueLength) return s.slice(0, this.opts.maxValueLength) + "…";
			return typeof v === "string" ? v : JSON.parse(s);
		} catch {
			return String(v).slice(0, this.opts.maxValueLength);
		}
	}

	private computeGcStatus(ctx: GripContext | undefined): "live" | "collected" | "unknown" {
		// If WeakRef is unavailable, we cannot infer; however in this runtime it exists
		return ctx ? "live" : "collected";
	}
}


