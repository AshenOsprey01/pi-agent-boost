// Test-only harness: runs the Sharpener's real model call without the TUI.
// Usage: pi --no-session --no-extensions -e test/sharpen-harness.ts -p "/sharpen-test <draft>"
// Prints the picked model, the rewrite, and the cost to stderr.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pickModel, sharpen } from "../extensions/prompt-sharpener.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("sharpen-test", {
		description: "test harness",
		handler: async (args, ctx) => {
			const { model, reason } = pickModel(ctx.modelRegistry.getAvailable(), ctx.model, process.env.PI_BOOST_SHARPEN_MODEL, (p, id) =>
				ctx.modelRegistry.find(p, id),
			);
			process.stderr.write(`[harness] model=${model?.provider}/${model?.id} (${reason})\n`);
			try {
				const r = await sharpen(ctx, model, args);
				process.stderr.write(`[harness] cost=${r?.cost}\n----- REWRITE -----\n${r?.text}\n----- END -----\n`);
			} catch (e) {
				process.stderr.write(`[harness] ERROR ${String(e)}\n`);
			}
		},
	});
}
