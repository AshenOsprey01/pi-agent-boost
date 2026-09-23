// Throwaway API probe for PLAN §4 verification. Not part of the package.
// Logs to stderr: input sources, stopReason at agent_end, API feature detection,
// and queues exactly one follow-up from agent_end to prove the Done-Gate mechanism.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	let fired = false;
	const log = (s: string) => process.stderr.write(`[probe] ${s}\n`);
	log(`typebox ok: ${typeof Type.String === "function"}`);

	pi.on("input", (e) => {
		log(`input source=${e.source} text=${JSON.stringify(e.text.slice(0, 40))}`);
		return { action: "continue" };
	});

	pi.on("session_start", (_e, ctx) => {
		const r: any = ctx.modelRegistry;
		log(`mode=${(ctx as any).mode} hasUI=${ctx.hasUI}`);
		log(`complete=${typeof r?.complete} getAvailable=${typeof r?.getAvailable} find=${typeof r?.find}`);
		const haikus = (r?.getAvailable?.() ?? []).filter((m: any) => /haiku/i.test(m.id)).map((m: any) => `${m.provider}/${m.id}`);
		log(`available haiku: ${haikus.join(", ") || "(none)"}`);
	});

	pi.on("agent_end", (e) => {
		const last: any = [...e.messages].reverse().find((m: any) => m.role === "assistant");
		log(`agent_end messages=${e.messages.length} stopReason=${last?.stopReason} errorMessage=${last?.errorMessage ?? ""}`);
		if (!fired) {
			fired = true;
			pi.sendUserMessage("[probe] Reply with just the word PONG.", { deliverAs: "followUp" });
			log("queued follow-up");
		}
	});
}
