// ADAPT: PI_BOOST_POWERSHELL if powershell.exe is blocked at work but pwsh.exe is allowed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "outlook.ps1");
const TIMEOUT_MS = 120_000; // searching "all" walks every folder of a large mailbox
const READ_DEFAULT_CHARS = 8000;
const SAVE_MAX_CHARS = 500_000;

export interface Hit {
	entry_id: string;
	store_id: string;
	date: string;
	from: string;
	to: string;
	subject: string;
	folder: string;
	attachments: number;
	preview: string;
}

export interface Mail {
	subject: string;
	from: string;
	from_email: string;
	to: string;
	cc: string;
	date: string;
	folder: string;
	attachments: { name: string; size: number }[];
	body: string;
	body_length: number;
	truncated: boolean;
}

// EntryIDs are ~140 hex chars; short ids save tokens. They live in memory, so they reset on /reload.
export class IdStore {
	private byShort = new Map<string, { entry_id: string; store_id: string }>();
	private byEntry = new Map<string, string>();
	add(entry_id: string, store_id: string): string {
		const known = this.byEntry.get(entry_id);
		if (known) return known;
		const id = `m${this.byShort.size + 1}`;
		this.byShort.set(id, { entry_id, store_id });
		this.byEntry.set(entry_id, id);
		return id;
	}
	get(id: string) {
		return this.byShort.get(id.trim());
	}
}

export function encodeRequest(req: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(req), "utf8").toString("base64");
}

const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function formatSearch(res: { results: Hit[]; folder: string; folders_searched: number; more_may_exist: boolean }, ids: IdStore): string {
	const where = `${res.folder}${res.folders_searched > 1 ? ` + subfolders (${res.folders_searched} folders)` : ""}`;
	if (!res.results.length) return `No emails found in ${where}. Try fewer filters, another folder, or folder "all".`;
	const lines = [`${res.results.length} email(s) in ${where}, newest first:`];
	for (const h of res.results) {
		const id = ids.add(h.entry_id, h.store_id);
		const att = h.attachments ? ` | att: ${h.attachments}` : "";
		lines.push(`[${id}] ${h.date} | from: ${oneLine(h.from)} | to: ${oneLine(h.to)} | ${oneLine(h.subject) || "(no subject)"} | ${h.folder}${att}`);
		if (h.preview) lines.push(`     ${h.preview}`);
	}
	if (res.more_may_exist) lines.push("(more may exist: raise limit or narrow the filters)");
	lines.push("Use outlook_read with an id for the full email.");
	return lines.join("\n");
}

export function formatFolders(res: { folders: { path: string; count: number }[]; capped: boolean }): string {
	const lines = res.folders.map((f) => (f.count < 0 ? `\n${f.path}  (mailbox)` : `${f.path}  (${f.count})`));
	if (res.capped) lines.push("(list capped: pass mailbox or max_depth to narrow it)");
	return lines.join("\n").trim();
}

function attachmentList(m: Mail): string {
	return m.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} KB)`).join(", ");
}

export function formatMail(m: Mail, maxChars: number): string {
	const body = m.body.replace(/\r\n/g, "\n").trim();
	const shown = body.length > maxChars ? body.slice(0, maxChars) : body;
	const cut = m.truncated || body.length > maxChars;
	return [
		`Subject: ${m.subject || "(no subject)"}`,
		`From: ${m.from}${m.from_email ? ` <${m.from_email}>` : ""}`,
		`To: ${m.to}`,
		...(m.cc ? [`Cc: ${m.cc}`] : []),
		`Date: ${m.date}`,
		`Folder: ${m.folder}`,
		...(m.attachments.length ? [`Attachments: ${attachmentList(m)}`] : []),
		"",
		shown,
		...(cut ? [`\n[truncated: showing ${shown.length} of ${m.body_length} characters, raise max_chars for more]`] : []),
	].join("\n");
}

const yaml = (s: string) => JSON.stringify(s ?? "");

export function toMarkdown(m: Mail): string {
	const fm = [
		"---",
		`subject: ${yaml(m.subject)}`,
		`from: ${yaml(m.from_email ? `${m.from} <${m.from_email}>` : m.from)}`,
		`to: ${yaml(m.to)}`,
		...(m.cc ? [`cc: ${yaml(m.cc)}`] : []),
		`date: ${yaml(m.date)}`,
		`folder: ${yaml(m.folder)}`,
		...(m.attachments.length ? [`attachments: ${yaml(attachmentList(m))}`] : []),
		"---",
	];
	return `${fm.join("\n")}\n\n# ${m.subject || "(no subject)"}\n\n${m.body.replace(/\r\n/g, "\n").trim()}\n`;
}

export function mailFileName(m: Mail): string {
	const subject = (m.subject || "no subject").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
	return `${m.date.slice(0, 10)} ${subject}.md`;
}

function freePath(path: string): string {
	if (!existsSync(path)) return path;
	const ext = extname(path);
	for (let i = 2; ; i++) {
		const p = `${path.slice(0, -ext.length)} (${i})${ext}`;
		if (!existsSync(p)) return p;
	}
}

function tail(text: string, max = 1500): string {
	const t = text.trim();
	return t.length <= max ? t : "…" + t.slice(-max);
}

export default function outlookReader(pi: ExtensionAPI) {
	const ids = new IdStore();
	const shell = process.env.PI_BOOST_POWERSHELL || "powershell.exe";

	async function run<T>(req: Record<string, unknown>, signal: AbortSignal | undefined, cwd: string): Promise<T> {
		if (process.platform !== "win32") throw new Error("outlook: only works on Windows with classic Outlook");
		const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Request", encodeRequest(req)];
		let result;
		try {
			result = await pi.exec(shell, args, { signal, timeout: TIMEOUT_MS, cwd });
		} catch (err) {
			throw new Error(`outlook: could not start ${shell}. Set PI_BOOST_POWERSHELL. ${String(err)}`);
		}
		if (result.killed) throw new Error(`outlook: timed out or cancelled after ${TIMEOUT_MS / 1000}s (narrow the folder or filters)`);
		if (result.code !== 0) throw new Error(tail(result.stderr || result.stdout) || `outlook: ${shell} exited with code ${result.code}`);
		try {
			return JSON.parse(result.stdout) as T;
		} catch {
			throw new Error(`outlook: unexpected output: ${tail(result.stdout, 300)}`);
		}
	}

	pi.registerTool({
		name: "outlook_folders",
		label: "Outlook Folders",
		description:
			"List the user's Outlook mail folders (all mailboxes, incl. shared) as paths with item counts, e.g. " +
			"'alexa@corp.com/Inbox/Clients/ACME  (42)'. Use it to find the exact folder path for outlook_search. Read-only.",
		promptSnippet: "List Outlook mail folders (paths + counts)",
		parameters: Type.Object({
			mailbox: Type.Optional(Type.String({ description: "Only mailboxes whose name contains this text" })),
			max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Folder depth (default 10)" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const res = await run<{ folders: { path: string; count: number }[]; capped: boolean }>(
				{ action: "folders", ...params },
				signal,
				ctx.cwd,
			);
			return { content: [{ type: "text", text: formatFolders(res) }], details: { count: res.folders.length } };
		},
	});

	pi.registerTool({
		name: "outlook_search",
		label: "Outlook Search",
		description:
			"Search the user's Outlook email (classic Outlook on Windows). Returns short ids, date, sender, recipients, " +
			"subject, folder and a 150-char preview, newest first. Filters are case-insensitive 'contains' matches and combine with AND. " +
			"folder: 'Inbox' (default), 'Sent', 'Drafts', 'Deleted', 'Junk', 'all' (whole mailbox), a path like " +
			"'Inbox/Clients/ACME', or a full path from outlook_folders. Read-only: never sends, moves or changes email.",
		promptSnippet: "Search Outlook email by folder, sender, recipient, subject, text, date",
		promptGuidelines: [
			"For questions about the user's emails, use outlook_search / outlook_read instead of asking the user to paste emails.",
			"For emails the user sent, search folder 'Sent'. If the folder is unknown, search 'all' or call outlook_folders.",
		],
		parameters: Type.Object({
			folder: Type.Optional(Type.String({ description: "Inbox (default), Sent, Drafts, Deleted, Junk, all, or a path like Inbox/Clients" })),
			include_subfolders: Type.Optional(Type.Boolean({ description: "Also search subfolders of folder (default false)" })),
			from: Type.Optional(Type.String({ description: "Sender name or address contains" })),
			to: Type.Optional(Type.String({ description: "To/Cc display names contain" })),
			subject: Type.Optional(Type.String({ description: "Subject contains" })),
			text: Type.Optional(Type.String({ description: "Subject or body contains" })),
			since: Type.Optional(Type.String({ description: "On or after, e.g. 2025-05-01 or 2025-05-01 14:00" })),
			until: Type.Optional(Type.String({ description: "On or before (a date means the whole day)" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Max results (default 10)" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const res = await run<{ results: Hit[]; folder: string; folders_searched: number; more_may_exist: boolean }>(
				{ action: "search", ...params },
				signal,
				ctx.cwd,
			);
			return { content: [{ type: "text", text: formatSearch(res, ids) }], details: { count: res.results.length } };
		},
	});

	pi.registerTool({
		name: "outlook_read",
		label: "Outlook Read",
		description:
			"Read one Outlook email by the id from outlook_search (e.g. 'm3'): headers, attachment names and plain-text body. " +
			"save_to writes the full email as Markdown with frontmatter (for notes/Obsidian): a .md file path, or a folder " +
			"(file name becomes 'YYYY-MM-DD subject.md'). Read-only in Outlook.",
		promptSnippet: "Read a full Outlook email by id, optionally save it as Markdown",
		parameters: Type.Object({
			id: Type.String({ description: "Id from outlook_search, e.g. m3" }),
			max_chars: Type.Optional(Type.Integer({ minimum: 200, maximum: 50000, description: `Body characters to return (default ${READ_DEFAULT_CHARS})` })),
			save_to: Type.Optional(Type.String({ description: "Save as Markdown: .md file path or folder (relative to cwd)" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const ref = ids.get(params.id);
			if (!ref) throw new Error(`outlook: unknown id '${params.id}'. Ids come from outlook_search and reset on /reload: search again.`);
			const maxChars = params.max_chars ?? READ_DEFAULT_CHARS;
			const mail = await run<Mail>(
				{ action: "read", ...ref, max_chars: params.save_to ? SAVE_MAX_CHARS : maxChars },
				signal,
				ctx.cwd,
			);
			let text = formatMail(mail, maxChars);
			let saved: string | undefined;
			if (params.save_to) {
				const target = resolve(ctx.cwd, params.save_to.replace(/^@/, ""));
				const file = freePath(extname(target).toLowerCase() === ".md" ? target : join(target, mailFileName(mail)));
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, toMarkdown(mail), "utf8");
				saved = file;
				text = `Saved to ${saved}\n\n${text}`;
			}
			return { content: [{ type: "text", text }], details: { id: params.id, saved } };
		},
	});
}
