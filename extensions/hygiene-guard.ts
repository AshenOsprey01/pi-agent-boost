import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export const MAX_LINES = 200;
export const MAX_CHARS = 16_000;
const ALLOWED_MD = new Set(["agents.md", "plan.md", "todo.md"]);
const RESOURCE_DIRS = new Set(["prompts", "snippets", "agents"]);

export function resolveTarget(cwd: string, p: string): string {
	let path = p.startsWith("@") ? p.slice(1) : p;
	if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) path = homedir() + path.slice(1);
	return resolve(cwd, path);
}

function hasAncestorWith(absPath: string, names: string[], exists: (p: string) => boolean): boolean {
	let dir = dirname(absPath);
	while (true) {
		if (names.some((n) => exists(resolve(dir, n)))) return true;
		const up = dirname(dir);
		if (up === dir) return false;
		dir = up;
	}
}

export const inVault = (absPath: string, exists: (p: string) => boolean = existsSync) =>
	hasAncestorWith(absPath, [".obsidian"], exists);

/** Obsidian vault or skill folder: md files are the content there, not project clutter. */
export const isMdHome = (absPath: string, exists: (p: string) => boolean = existsSync) =>
	hasAncestorWith(absPath, [".obsidian", "SKILL.md"], exists);

export function strayMdReason(absPath: string, exists: (p: string) => boolean = existsSync): string | undefined {
	const name = basename(absPath);
	if (!name.toLowerCase().endsWith(".md") || exists(absPath)) return undefined;
	if (ALLOWED_MD.has(name.toLowerCase()) || name === "SKILL.md") return undefined;
	if (dirname(absPath).split(/[\\/]/).some((s) => RESOURCE_DIRS.has(s.toLowerCase()))) return undefined;
	if (isMdHome(absPath, exists)) return undefined;
	return (
		`hygiene-guard: new md files are not allowed (${name}). Put project-wide facts in AGENTS.md and ` +
		"local facts as a WHY comment next to the code. (PLAN.md/TODO.md are allowed temporarily.)"
	);
}

/** Mirrors Pi's edit tool: each oldText is matched once against the original. Undefined if one is missing. */
export function applyEdits(original: string, edits: { oldText: string; newText: string }[]): string | undefined {
	const text = original.replace(/\r\n/g, "\n");
	const spans: { start: number; end: number; newText: string }[] = [];
	for (const e of edits) {
		const oldText = e.oldText.replace(/\r\n/g, "\n");
		const start = text.indexOf(oldText);
		if (start < 0) return undefined;
		spans.push({ start, end: start + oldText.length, newText: e.newText.replace(/\r\n/g, "\n") });
	}
	spans.sort((a, b) => b.start - a.start);
	let out = text;
	for (const s of spans) out = out.slice(0, s.start) + s.newText + out.slice(s.end);
	return out;
}

export function capReason(text: string): string | undefined {
	const norm = text.replace(/\r\n/g, "\n");
	const lines = norm === "" ? 0 : norm.replace(/\n$/, "").split("\n").length;
	if (lines <= MAX_LINES && norm.length <= MAX_CHARS) return undefined;
	return (
		`hygiene-guard: AGENTS.md would be ${lines} lines / ${norm.length} characters (cap ${MAX_LINES} / ${MAX_CHARS}). ` +
		"Shorten it: drop anything the code already shows (file trees, function lists) and keep one line per fact."
	);
}

export function agentsMdText(absPath: string, toolName: string, input: any): string | undefined {
	if (basename(absPath).toLowerCase() !== "agents.md") return undefined;
	if (toolName === "write") return typeof input?.content === "string" ? input.content : undefined;
	if (!Array.isArray(input?.edits) || !existsSync(absPath)) return undefined;
	return applyEdits(readFileSync(absPath, "utf8"), input.edits);
}

export const MAIN_REASON =
	"hygiene-guard: you are on main. Create a short task branch first: `git switch -c <short-task-name>`, then retry.";

export default function hygieneGuard(pi: ExtensionAPI) {
	if ((process.env.PI_BOOST_GUARD ?? "").toLowerCase() === "off") return;
	// No caching: the agent often runs `git switch -c` and retries right away.
	const onMainBranch = async (dir: string): Promise<boolean> => {
		const head = await pi.exec("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"], { timeout: 3000 });
		const branch = head.code === 0 ? head.stdout.trim() : "";
		if (branch !== "main" && branch !== "master") return false;
		// A repo with no commits yet must be able to get its first commit on main.
		const born = await pi.exec("git", ["-C", dir, "rev-parse", "--verify", "-q", "HEAD"], { timeout: 3000 });
		return born.code === 0;
	};

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const input = event.input as any;
		if (typeof input?.path !== "string") return;
		const abs = resolveTarget(ctx.cwd, input.path);

		const stray = strayMdReason(abs);
		if (stray) return { block: true, reason: stray };

		const agentsText = agentsMdText(abs, event.toolName, input);
		const cap = agentsText === undefined ? undefined : capReason(agentsText);
		if (cap) return { block: true, reason: cap };

		if (inVault(abs)) return;
		let dir = dirname(abs);
		while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
		if (await onMainBranch(dir)) return { block: true, reason: MAIN_REASON };
	});
}
