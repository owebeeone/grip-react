import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Grok, GraphDump, GraphDumpKeyRegistry, GripGraphDumper } from "@owebeeone/grip-core";

export function GraphDumpDialog(props: {
	open: boolean;
	onClose: () => void;
	grok: Grok;
	keys?: GraphDumpKeyRegistry;
}) {
	const { open, onClose, grok, keys } = props;
	const [copied, setCopied] = useState(false);
	const [includeValues, setIncludeValues] = useState(true);
	const [includeTapValues, setIncludeTapValues] = useState(false);
	const dump: GraphDump | null = useMemo(() => {
		if (!open) return null;
		const dumper = new GripGraphDumper({ grok, keys, opts: { includeValues, includeTapValues } });
		return dumper.dump();
	}, [open, grok, keys, includeValues, includeTapValues]);

	if (!open) return null;

	const json = JSON.stringify(dump, null, 2);

	return createPortal(
		<div style={overlayStyle} role="dialog" aria-modal="true">
			<div style={dialogStyle}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
					<strong>Grip Graph Dump</strong>
					<button onClick={onClose} aria-label="Close">Dismiss</button>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
					<div style={{ fontSize: 12, color: "#555" }}>
						Timestamp: {(dump && dump.timestampIso) || new Date().toISOString()}
					</div>
					<label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
						<input type="checkbox" checked={includeValues} onChange={(e) => setIncludeValues(e.target.checked)} />
						Include drip values
					</label>
					<label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
						<input type="checkbox" checked={includeTapValues} onChange={(e) => setIncludeTapValues(e.target.checked)} />
						Include tap destination values
					</label>
				</div>
				<div style={contentStyle}>
					<pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
						{json}
					</pre>
				</div>
				<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
					<button
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(json);
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							} catch {}
						}}
					>
						{copied ? "Copied!" : "Copy"}
					</button>
					<button onClick={onClose}>Dismiss</button>
				</div>
			</div>
		</div>,
		document.body
	);
}

const overlayStyle: React.CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	background: "rgba(0,0,0,0.3)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 9999,
};

const dialogStyle: React.CSSProperties = {
	width: "min(900px, 90vw)",
	height: "min(70vh, 800px)",
	background: "white",
	borderRadius: 8,
	boxShadow: "0 6px 24px rgba(0,0,0,0.2)",
	padding: 12,
	display: "flex",
	flexDirection: "column",
};

const contentStyle: React.CSSProperties = {
	flex: "1 1 auto",
	minHeight: 0,
	background: "#fafafa",
	border: "1px solid #eee",
	borderRadius: 6,
	padding: 8,
	overflow: "auto",
};


