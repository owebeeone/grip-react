import { Grok } from "./grok";
import { Grip } from "./grip";
import { Drip } from "./drip";
import { GripContextNode, ProducerRecord } from "./graph";
import type { Tap } from "./tap";

export type SanityIssue = { contextId: string; message: string };

export class GripGraphSanityChecker {
  private readonly issuesByContextId = new Map<string, string>();

  constructor(private readonly grok: Grok) {
    this.buildIndex();
  }

  private buildIndex(): void {
    // Rule: param-only destinations without outputs

    const {nodes, missingNodes} = this.grok.getGraphSanityCheck();
    for (const node of nodes.values()) {

      // Scan children that don't node as a parent.
      for (const child of node.get_children_nodes()) {
        if (!child.get_parent_nodes().includes(node)) {
          this.addIssue(child, `Parent ${node.id} has child ${child.id} but child does not have parent ${node.id}`);
        }
      }

      for (const [, rec] of node.get_producers()) {
        for (const [destNode, destination] of rec.getDestinations()) {
          const outputs = Array.from(destination.getGrips());
          const tap: any = rec.tap as any;
          const hasDestParams = Array.isArray(tap.destinationParamGrips) && tap.destinationParamGrips.length > 0;

          // Determine whether all destination-parameter drips have zero subscribers
          const paramDrips = Array.from(destination.getDestinationParamDrips().values());
          const allParamSubsZero = paramDrips.every((d) => {
            const anyDrip = d as any;
            const a = anyDrip?.subs instanceof Set ? anyDrip.subs.size : 0;
            const b = anyDrip?.immediateSubs instanceof Set ? anyDrip.immediateSubs.size : 0;
            return (a + b) === 0;
          });

          if (hasDestParams && outputs.length === 0) {
            // Flag: tap maintains a param-only destination; include hint if params also unsubscribed
            const msg = allParamSubsZero
              ? `Drip unsubscribe failed: param-only destination and no param subscribers`
              : `Drip unsubscribe failed: param-only destination without outputs`;
            this.addIssue(destNode, msg);
          }
        }
      }
    }
  }

  addIssue(node: GripContextNode, msg: string): void {
    if (!this.issuesByContextId.has(node.id)) {
      this.issuesByContextId.set(node.id, msg);
    } else {
      const current = this.issuesByContextId.get(node.id);
      if (current) {
        this.issuesByContextId.set(node.id, `${current}\n${msg}`);
      }
    }
  }

  reportContext(node: GripContextNode): string | null {
    return this.issuesByContextId.get(node.id) ?? null;
  }

  runAll(): SanityIssue[] {
    const out: SanityIssue[] = [];
    for (const [contextId, message] of this.issuesByContextId) out.push({ contextId, message });
    return out;
  }
}


