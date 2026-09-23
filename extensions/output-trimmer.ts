// `read` results are never trimmed: the agent asked for those explicitly.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ADAPT: add custom shell tools here.
export const SHELL_TOOLS = new Set(["bash", "powershell"]);
const DIR = join(tmpdir(), "pi-boost");
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

// Pi's bash truncation footer, e.g. "\n\n[Showing lines 1-2000 of 9000. Full output: C:\...\x.log]"
const PI_NOTE = /\n\n\[Showing [^\n]*\]\s*$/;

/** Take whole lines from the start (or end) until the byte budget is used. */
function takeLines(lines: string[], budget: number, fromEnd: boolean): string[] {
	const out: string[] = [];
	let used = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = fromEnd ? lines[lines.length - 1 - i] : lines[i];
		const size = bytes(line) + 1;
		if (used + size > budget) {
			// A single giant line (minified JSON, progress bars): cut it by characters.
			if (out.length === 0) out.push(fromEnd ? "…" + line.slice(-budget) : line.slice(0, budget) + "…");
			break;
		}
		out.push(line);
		used += size;
	}
	return fromEnd ? out.reverse() : out;
}

/** Pure trim (exported for tests). Null if no trim is needed; `pathFor` is only called when trimming. */
export function trimText(text: string, limit: number, pathFor: () => string): { text: string; omittedLines: number } | null {
	if (limit <= 0 || bytes(text) <= limit) return null;
	const noteMatch = text.match(PI_NOTE);
	const piNote = noteMatch ? noteMatch[0] : "";
	const body = piNote ? text.slice(0, -piNote.length) : text;
	const lines = body.split("\n");
	const part = Math.floor(limit * 0.375); // 3000 each at the default 8000
	const head = takeLines(lines, part, false);
	const tail = takeLines(lines.slice(head.length), part, true);
	const omitted = lines.length - head.length - tail.length;
	if (omitted <= 0 && bytes(body) <= limit) return null;
	const omittedBytes = Math.max(0, bytes(body) - bytes(head.join("\n")) - bytes(tail.join("\n")));
	const note = `… [output-trimmer: ${omitted} lines / ${kb(omittedBytes)} omitted — full output: ${pathFor()} — use read to see more]`;
	return { text: [...head, note, ...tail].join("\n") + piNote, omittedLines: omitted };
}

function cleanOldFiles() {
	try {
		const now = Date.now();
		for (const f of readdirSync(DIR)) {
			const p = join(DIR, f);
			if (now - statSync(p).mtimeMs > MAX_AGE_MS) unlinkSync(p);
		}
	} catch {
		// Directory missing or locked file: nothing to do.
	}
}

export default function outputTrimmer(pi: ExtensionAPI) {
	const raw = process.env.PI_BOOST_TRIM_BYTES;
	const limit = raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : 8000;
	if (limit <= 0) return;

	pi.on("session_start", () => cleanOldFiles());

	pi.on("tool_result", (event) => {
		if (!SHELL_TOOLS.has(event.toolName)) return;
		const texts = event.content.filter((c): c is { type: "text"; text: string } => c.type === "text");
		if (texts.length === 0) return;
		const full = texts.map((c) => c.text).join("\n");
		const piFile = (event.details as { fullOutputPath?: string } | undefined)?.fullOutputPath;

		const result = trimText(full, limit, () => {
			if (piFile) return piFile; // Pi already saved the complete output
			const path = join(DIR, `${event.toolCallId.replace(/[^\w.-]/g, "_")}.txt`);
			try {
				mkdirSync(DIR, { recursive: true });
				writeFileSync(path, full, "utf8");
				return path;
			} catch {
				return "(could not save full output)";
			}
		});
		if (!result) return;
		const others = event.content.filter((c) => c.type !== "text");
		return { content: [{ type: "text", text: result.text }, ...others] };
	});
}
