/**
 * Done-Gate: after the agent edits files, send it back ONCE to prove the change
 * works and to finish anything from the request it skipped.
 *
 * Trigger:   automatic. When an agent run ends and the run edited files
 *            (successful `edit` or `write` tool results), a single follow-up
 *            message "[done-gate] ..." is queued. It fires at most once per
 *            user prompt, so it cannot loop.
 * Skips:     gate off, no edits, already fired for this prompt, run aborted
 *            (Esc) or ended in an error.
 * Controls:  /done-gate or alt+g toggles on/off. Status bar shows "gate ✓" when on.
 * Config:    PI_BOOST_DONE_GATE=off  starts with the gate disabled
 *            (useful for subagent processes that should not self-verify).
 * ADAPT:     MUTATING_TOOLS: add any custom file-writing tool names used at work.
 *
 * Works on Pi 0.84.x and 0.87.x (uses only agent_end + sendUserMessage followUp).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Tools whose successful result means "files changed". bash/powershell are
// shells and are NOT counted, so read-only Q&A that runs `ls` never triggers.
// ADAPT: add custom file-writing tools here.
export const MUTATING_TOOLS = new Set(["edit", "write"]);

export const GATE_TEXT =
	"[done-gate] Before you finish: (1) run or check what you changed and show the exact command " +
	"and its output as proof; (2) list anything from my request that is not done yet, and do it now; " +
	"(3) remove any comments you added that only restate the code; if the task is fully done, move lasting " +
	"facts into AGENTS.md or WHY comments and delete PLAN.md/TODO.md. " +
	'If you already verified after your last change and everything is done, reply only with a one-line ' +
	'"Verified: <evidence>" and a one-line done list.';

export interface GateState {
	enabled: boolean;
	edited: boolean; // a mutating tool succeeded since the last agent_end
	fired: boolean; // gate already sent for the current user prompt
}

/** Pure decision helper (exported for tests). */
export function shouldFire(state: GateState, messages: readonly unknown[]): boolean {
	if (!state.enabled || !state.edited || state.fired) return false;
	const last = [...messages].reverse().find((m: any) => m?.role === "assistant") as any;
	const stop = last?.stopReason;
	if (stop === "aborted" || stop === "error") return false;
	return true;
}

export default function doneGate(pi: ExtensionAPI) {
	const state: GateState = {
		enabled: (process.env.PI_BOOST_DONE_GATE ?? "").toLowerCase() !== "off",
		edited: false,
		fired: false,
	};

	const updateStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("done-gate", state.enabled ? ctx.ui.theme.fg("success", "gate ✓") : undefined);
	};

	const toggle = (ctx: ExtensionContext) => {
		state.enabled = !state.enabled;
		updateStatus(ctx);
		if (ctx.hasUI) ctx.ui.notify(`Done-Gate ${state.enabled ? "on" : "off"}`, "info");
	};

	pi.on("session_start", (_event, ctx) => updateStatus(ctx));

	// A new prompt from the user (or an RPC client) starts a fresh gate cycle.
	// Our own follow-up arrives with source "extension" and must not reset it.
	pi.on("input", (event) => {
		if (event.source !== "extension") state.fired = false;
		return { action: "continue" };
	});

	pi.on("tool_result", (event) => {
		if (!event.isError && MUTATING_TOOLS.has(event.toolName)) state.edited = true;
	});

	pi.on("agent_end", (event) => {
		const fire = shouldFire(state, event.messages);
		state.edited = false;
		if (!fire) return;
		// Set before sending: the follow-up's input event fires synchronously.
		state.fired = true;
		pi.sendUserMessage(GATE_TEXT, { deliverAs: "followUp" });
	});

	pi.registerCommand("done-gate", {
		description: "Toggle Done-Gate (verify + finish after edits)",
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.registerShortcut("alt+g", {
		description: "Toggle Done-Gate",
		handler: async (ctx) => toggle(ctx),
	});
}
