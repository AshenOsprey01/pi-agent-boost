/**
 * Prompt Sharpener: rewrite the editor draft into a clear, well-structured
 * prompt with a fast, cheap model. Keeps your intent and never adds facts.
 * Never auto-sends: you review the result and press Enter yourself.
 *
 * Trigger:   alt+e sharpens the editor draft; /sharpen <draft text> sharpens
 *            the given text (typing a command submits the editor, so the
 *            command takes the draft as its argument). Interactive TUI only.
 * Undo:      alt+shift+e or /unsharpen puts your original draft back
 *            (the editor's own undo, ctrl+-, also works).
 * Context:   the draft, the last user/assistant exchange (≤ ~3,000 chars,
 *            only so "it"/"that" can be resolved), and the cwd folder name.
 * Model:     1. PI_BOOST_SHARPEN_MODEL="provider/modelId" if set and found
 *            2. else the newest available model whose id contains "haiku"
 *            3. else the current session model
 * Config:    PI_BOOST_SHARPEN_MODEL (optional)
 * ADAPT:     at work, set PI_BOOST_SHARPEN_MODEL to the gateway's Haiku 4.5 id
 *            if auto-pick doesn't find it (check the id with /model).
 *
 * Works on Pi 0.84.x and 0.87.x (uses ctx.modelRegistry.complete, feature-detected).
 */
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

export const SYSTEM_PROMPT = `You rewrite a user's rough draft into a clear prompt for an AI coding agent.

Rules:
- Keep the user's intent, voice, and language. Fix spelling, grammar, and unclear wording.
- Keep EVERY piece of information from the draft, including hunches and uncertainty ("i think its the join" -> "I suspect the join is the cause"). Do not turn a guess into a fact, or a fact into a guess.
- Never invent anything: no new facts, file names, column names, numbers, libraries, tools, steps, or requirements. Only use what the draft (and, for resolving references like "it" or "that", the previous exchange) actually says.
- Preserve code, paths, identifiers, commands, numbers, and quoted text exactly as written.
- The working folder name is background only. Never add it (or any location) to the prompt unless the draft mentions it.
- Match the length to the draft. A request with one or two requirements stays one or two plain sentences, with no headings.
- Count the distinct requirements in the draft. If there are three or more, you MUST structure the prompt with these headings (only the ones that have content), using short bullets:
  Goal:
  Context: (only facts the user gave)
  Constraints:
  Done when: (only criteria the user stated or that directly restate their requirements)
- Only if a decision that only the user can make is genuinely ambiguous, end with "Open questions:" and at most 3 short items. Never ask about things the agent can find itself by reading files, code, or data (file locations, column names, current values). Usually there are no open questions.
  Example: draft "make a script that loads trades.csv, drops cancelled trades, sums notional per desk, writes it to out.xlsx. must use polars" becomes:
  Goal: Write a script that summarises notional per desk from trades.csv.
  Constraints:
  - Drop cancelled trades before summing.
  - Use polars.
  Done when:
  - Notional per desk is written to out.xlsx.
- No generic filler ("be careful", "use best practices", "ensure quality").
- Write as the user, addressing the agent ("Add...", "Check..."), not about the user.
- Output ONLY the rewritten prompt. No preamble, no explanation, no code fences around the whole prompt.`;

const MAX_CONTEXT_CHARS = 3000;

type AnyModel = { provider: string; id: string };

/**
 * Version numbers in a model id, for "newest" ranking. Aliases like "...-latest"
 * rank lowest: their real version is unknown (on OpenRouter it was an older Haiku).
 */
function versionKey(id: string): number[] {
	if (/latest/i.test(id)) return [];
	return (id.match(/\d+/g) ?? []).map(Number).filter((n) => n < 1000); // drop date stamps
}

function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? -1) - (b[i] ?? -1);
		if (d !== 0) return d;
	}
	return 0;
}

/**
 * Pure model choice (exported for tests). Returns the model and why it was picked.
 * Skips ":batch"-style variants. Prefers the current model's provider on ties.
 */
export function pickModel<M extends AnyModel>(
	available: M[],
	current: M | undefined,
	envSpec: string | undefined,
	find: (provider: string, id: string) => M | undefined,
): { model: M | undefined; reason: string } {
	if (envSpec) {
		const slash = envSpec.indexOf("/");
		const found = slash > 0 ? find(envSpec.slice(0, slash), envSpec.slice(slash + 1)) : undefined;
		if (found) return { model: found, reason: "PI_BOOST_SHARPEN_MODEL" };
	}
	const haikus = available
		.filter((m) => /haiku/i.test(m.id) && !m.id.includes(":"))
		.sort((a, b) => {
			const v = compareVersions(versionKey(b.id), versionKey(a.id));
			if (v !== 0) return v;
			return Number(b.provider === current?.provider) - Number(a.provider === current?.provider);
		});
	if (haikus[0]) return { model: haikus[0], reason: envSpec ? "env model not found; auto haiku" : "auto haiku" };
	return { model: current, reason: "current model (no haiku found)" };
}

function textOf(msg: any): string {
	if (typeof msg?.content === "string") return msg.content;
	if (!Array.isArray(msg?.content)) return "";
	return msg.content
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n");
}

/** Last user + assistant texts from the current branch, truncated to ~3,000 chars total. */
export function lastExchange(entries: readonly any[]): { user: string; assistant: string } {
	let assistant = "";
	let user = "";
	for (let i = entries.length - 1; i >= 0; i--) {
		const m = entries[i]?.type === "message" ? entries[i].message : undefined;
		if (!m) continue;
		if (!assistant && m.role === "assistant") assistant = textOf(m);
		else if (assistant && m.role === "user") {
			user = textOf(m);
			break;
		}
	}
	const u = user.slice(0, 1000);
	const aMax = MAX_CONTEXT_CHARS - u.length;
	// Keep the END of the assistant reply: conclusions and questions are usually there.
	const a = assistant.length > aMax ? "…" + assistant.slice(-aMax) : assistant;
	return { user: u, assistant: a };
}

export function buildUserMessage(draft: string, folder: string, ex: { user: string; assistant: string }): string {
	const parts = [`Working folder: ${folder}`];
	if (ex.user || ex.assistant) {
		parts.push(
			"Previous exchange (ONLY for resolving references like \"it\"/\"that\"; do not copy its content into the prompt):",
			`<previous_user>\n${ex.user}\n</previous_user>`,
			`<previous_assistant>\n${ex.assistant}\n</previous_assistant>`,
		);
	}
	parts.push(`Draft to rewrite:\n<draft>\n${draft}\n</draft>`);
	return parts.join("\n\n");
}

/** Remove wrappers a model sometimes adds despite instructions. */
export function cleanOutput(text: string): string {
	let t = text.trim();
	t = t.replace(/^<draft>\s*([\s\S]*?)\s*<\/draft>$/i, "$1");
	const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
	if (fence) t = fence[1];
	return t.trim();
}

/** Core call (exported for the test harness). Returns null if aborted. */
export async function sharpen(
	ctx: ExtensionContext,
	model: any,
	draft: string,
	signal?: AbortSignal,
): Promise<{ text: string; cost?: number } | null> {
	const ex = lastExchange(ctx.sessionManager.getBranch());
	const response = await ctx.modelRegistry.complete(
		model,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [
				{ role: "user", content: [{ type: "text", text: buildUserMessage(draft, basename(ctx.cwd), ex) }], timestamp: Date.now() },
			],
		},
		{ signal, maxTokens: 2000 },
	);
	if (response.stopReason === "aborted") return null;
	if (response.stopReason === "error") throw new Error(response.errorMessage || "model error");
	const text = cleanOutput(textOf(response));
	if (!text) throw new Error("model returned an empty rewrite");
	return { text, cost: response.usage?.cost?.total };
}

export default function promptSharpener(pi: ExtensionAPI) {
	let original: string | undefined;

	const run = async (ctx: ExtensionContext, argDraft?: string) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Prompt Sharpener needs interactive mode", "warning");
			return;
		}
		if (typeof ctx.modelRegistry?.complete !== "function") {
			ctx.ui.notify("Prompt Sharpener: this Pi version has no modelRegistry.complete()", "error");
			return;
		}
		const draft = argDraft?.trim() || ctx.ui.getEditorText();
		if (!draft.trim()) {
			ctx.ui.notify("Nothing to sharpen: type a draft, then alt+e (or /sharpen <text>)", "info");
			return;
		}
		if (/^\/\S+$/.test(draft.trim())) {
			ctx.ui.notify("That looks like a command; not sharpened", "info");
			return;
		}
		const { model, reason } = pickModel(
			ctx.modelRegistry.getAvailable(),
			ctx.model,
			process.env.PI_BOOST_SHARPEN_MODEL,
			(p, id) => ctx.modelRegistry.find(p, id),
		);
		if (!model) {
			ctx.ui.notify("Prompt Sharpener: no model available", "error");
			return;
		}

		let error: string | undefined;
		const result = await ctx.ui.custom<{ text: string; cost?: number } | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, `Sharpening with ${model.id} (${reason})… Esc cancels`);
			loader.onAbort = () => done(null);
			sharpen(ctx, model, draft, loader.signal)
				.then(done)
				.catch((e) => {
					error = e instanceof Error ? e.message : String(e);
					done(null);
				});
			return loader;
		});

		if (error) {
			ctx.ui.notify(`Prompt Sharpener failed: ${error.slice(0, 200)}`, "error");
			return;
		}
		if (!result) {
			ctx.ui.notify("Cancelled: draft unchanged", "info");
			return;
		}
		original = draft;
		ctx.ui.setEditorText(result.text);
		const cost = typeof result.cost === "number" && result.cost > 0 ? ` ($${result.cost.toFixed(4)})` : "";
		ctx.ui.notify(`Sharpened with ${model.id}${cost}. Review, then Enter. alt+shift+e restores the original.`, "info");
	};

	const restore = (ctx: ExtensionContext) => {
		if (original === undefined) {
			ctx.ui.notify("No original draft to restore", "info");
			return;
		}
		ctx.ui.setEditorText(original);
		ctx.ui.notify("Original draft restored", "info");
	};

	pi.registerShortcut("alt+e", { description: "Sharpen the editor draft into a clear prompt", handler: (ctx) => run(ctx) });
	pi.registerShortcut("alt+shift+e", { description: "Restore the draft from before sharpening", handler: restore });
	pi.registerCommand("sharpen", {
		description: "Rewrite <text> into a clear prompt in the editor (or press alt+e on a draft)",
		handler: async (args, ctx) => run(ctx, args),
	});
	pi.registerCommand("unsharpen", { description: "Restore the draft from before sharpening (alt+shift+e)", handler: async (_a, ctx) => restore(ctx) });
}
