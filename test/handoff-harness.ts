// Test-only harness: after the first agent run, drafts a handoff prompt from the real
// conversation (no TUI needed) and prints it to stderr.
// Usage: pi --no-session --no-extensions -e test/handoff-harness.ts -p "<conversation prompt>"
// Goal comes from env HANDOFF_GOAL.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateHandoff } from "../extensions/handoff.ts";

export default function (pi: ExtensionAPI) {
	let done = false;
	pi.on("agent_end", async (_e, ctx) => {
		if (done) return;
		done = true;
		try {
			const text = await generateHandoff(ctx, ctx.model, process.env.HANDOFF_GOAL || "continue");
			process.stderr.write(`----- HANDOFF -----\n${text}\n----- END -----\n`);
		} catch (e) {
			process.stderr.write(`[harness] ERROR ${String(e)}\n`);
		}
	});
}
