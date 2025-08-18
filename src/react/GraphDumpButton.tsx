import React, { useState } from "react";
import { Grok } from "../core/grok";
import { GraphDumpDialog } from "./GraphDumpDialog";

export function GraphDumpButton(props: { grok: Grok; label?: string }) {
	const { grok, label } = props;
	const [open, setOpen] = useState(false);
	return (
		<>
			<button onClick={() => setOpen(true)}>{label ?? "Dump Graph"}</button>
			<GraphDumpDialog open={open} onClose={() => setOpen(false)} grok={grok} />
		</>
	);
}


