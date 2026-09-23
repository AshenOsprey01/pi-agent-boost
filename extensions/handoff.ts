/**
 * Derived from Pi's example extension `examples/extensions/handoff.ts`
 * (https://github.com/earendil-works/pi, MIT License, package author Mario Zechner).
 * Changes: a richer system prompt, optional model override, visible errors, and a fallback without newSession.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

export const SYSTEM_PROMPT = `You write the opening prompt for a NEW coding-agent session that continues work from an old conversation. The new session will NOT see the old conversation, only your prompt.

Given the conversation and the user's goal for the new session, write a self-contained prompt with these sections (skip a section if it would be empty):

## Goal
The next task, stated clearly from the user's goal. This is the most important part.

## Context
- What was built or changed so far, in one or two lines.
- Decisions made, each with a short reason ("Use X, because Y").
- Constraints and preferences the user stated (tools, style, things to avoid).
- Verified facts: things that were checked and confirmed (commands run, numbers checked, behaviour observed). Mark anything unverified as unverified.

## Files
Relevant files that were read or changed, with exact paths, and a few words on each.

## Open items
Anything left unfinished or known to be broken that matters for the goal.

Rules:
- Include only what helps with the goal. Omit dead ends, abandoned approaches, failed attempts, and chatter, unless a failure is a lesson worth keeping ("X does not work because Y").
- Preserve exact file paths, function names, identifiers, commands, numbers, and error messages.
- Never invent facts. If the conversation doesn't say it, leave it out.
- Don't add your own interpretations, inferences, or plan details (e.g. which currency a column is in, how to aggregate, which chart type). If the goal leaves a choice open, list it under Open items.
- Be concise: bullets, not paragraphs.
- Output only the prompt. No preamble like "Here's the prompt".`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

/** Branch messages; after a compaction: its summary plus the entries kept after it. */
export function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) return branch.map(entryToMessage).filter((m) => m !== undefined);
	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((e) => e.id === compaction.firstKeptEntryId) : -1;
	const kept = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return kept.map(entryToMessage).filter((m) => m !== undefined);
}

/** Pick PI_BOOST_HANDOFF_MODEL if set and found, else the current model (draft quality matters more than cost). */
function pickModel(ctx: { model?: any; modelRegistry: any }): any {
	const spec = process.env.PI_BOOST_HANDOFF_MODEL;
	const slash = spec ? spec.indexOf("/") : -1;
	if (spec && slash > 0) {
		const found = ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
		if (found) return found;
	}
	return ctx.model;
}

/** Core call (exported for the test harness). Returns null if aborted. */
export async function generateHandoff(ctx: any, model: any, goal: string, signal?: AbortSignal): Promise<string | null> {
	const messages = getHandoffMessages(ctx.sessionManager.getBranch());
	if (messages.length === 0) throw new Error("No conversation to hand off");
	const conversationText = serializeConversation(convertToLlm(messages));
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Session\n\n${goal}` }],
		timestamp: Date.now(),
	};
	const response = await ctx.modelRegistry.complete(
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
		{ signal, cacheRetention: "none", sessionId: uuidv7() },
	);
	if (response.stopReason === "aborted") return null;
	if (response.stopReason === "error") throw new Error(response.errorMessage || "model error");
	const text = response.content
		.filter((c: any): c is { type: "text"; text: string } => c.type === "text")
		.map((c: any) => c.text)
		.join("\n")
		.trim();
	if (!text) throw new Error("model returned an empty prompt");
	return text;
}

export default function handoff(pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Start a new focused session with a drafted prompt: /handoff <next task>",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for the new session>", "error");
				return;
			}
			const model = pickModel(ctx);
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}
			if (typeof ctx.modelRegistry?.complete !== "function") {
				ctx.ui.notify("handoff: this Pi version has no modelRegistry.complete()", "error");
				return;
			}

			const currentSessionFile = ctx.sessionManager.getSessionFile();
			let error: string | undefined;
			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Drafting handoff prompt with ${model.id}… Esc cancels`);
				loader.onAbort = () => done(null);
				generateHandoff(ctx, model, goal, loader.signal)
					.then(done)
					.catch((e) => {
						error = e instanceof Error ? e.message : String(e);
						done(null);
					});
				return loader;
			});
			if (error) {
				ctx.ui.notify(`Handoff failed: ${error.slice(0, 200)}`, "error");
				return;
			}
			if (result === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			const edited = await ctx.ui.editor("Edit handoff prompt (it opens in a new session)", result);
			if (edited === undefined) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Fallback for Pi versions without newSession (not seen on 0.84/0.87).
			if (typeof (ctx as any).newSession !== "function") {
				ctx.ui.setEditorText(edited);
				ctx.ui.notify("This Pi can't open a session from an extension: cut this draft, run /new, then paste it.", "warning");
				return;
			}

			// The replacement-session ctx must be used after the switch; the old ctx is stale.
			const res = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (newCtx) => {
					newCtx.ui.setEditorText(edited);
					newCtx.ui.notify("Handoff ready. Review, then press Enter.", "info");
				},
			});
			if (res.cancelled) ctx.ui.notify("New session cancelled", "info");
		},
	});
}
