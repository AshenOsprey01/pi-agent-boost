// Unit tests for Outlook Reader. Run: node --import ./test/stub-pi.mjs test/outlook.test.ts
// Needs no Outlook. On a PC with classic Outlook the last check also lists real folders (read-only).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import outlookReader, { encodeRequest, formatFolders, formatMail, formatSearch, IdStore, mailFileName, toMarkdown } from "../extensions/outlook/index.ts";
import type { Hit, Mail } from "../extensions/outlook/index.ts";

const SCRIPT = "extensions/outlook/outlook.ps1";
const decode = (b64: string) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

// Ids: short, stable per EntryID.
const ids = new IdStore();
assert.equal(ids.add("AAA", "S1"), "m1");
assert.equal(ids.add("BBB", "S1"), "m2");
assert.equal(ids.add("AAA", "S1"), "m1");
assert.deepEqual(ids.get(" m2 "), { entry_id: "BBB", store_id: "S1" });
assert.equal(ids.get("m9"), undefined);

// Request survives quotes and non-ASCII.
assert.deepEqual(decode(encodeRequest({ from: `Søren "S" O'Brien & <x>` })), { from: `Søren "S" O'Brien & <x>` });

const hit: Hit = {
	entry_id: "E1", store_id: "S1", date: "2025-05-12 14:03", from: "Jonas Berg", to: "Alexander\r\nX",
	subject: "Re: Q3 report", folder: "alexa@corp.com/Inbox/Clients", attachments: 2, preview: "Hi Alexander, attached...",
};
const s = formatSearch({ results: [hit], folder: "alexa@corp.com/Inbox", folders_searched: 3, more_may_exist: true }, new IdStore());
assert.match(s, /^1 email\(s\) in alexa@corp.com\/Inbox \+ subfolders \(3 folders\)/);
assert.match(s, /\[m1\] 2025-05-12 14:03 \| from: Jonas Berg \| to: Alexander X \| Re: Q3 report \| alexa@corp.com\/Inbox\/Clients \| att: 2/);
assert.match(s, /more may exist/);
assert.match(formatSearch({ results: [], folder: "x/Sent Items", folders_searched: 1, more_may_exist: false }, ids), /^No emails found in x\/Sent Items\./);

const f = formatFolders({ folders: [{ path: "alexa@corp.com", count: -1 }, { path: "alexa@corp.com/Inbox", count: 12 }], capped: false });
assert.equal(f, "alexa@corp.com  (mailbox)\nalexa@corp.com/Inbox  (12)");

const mail: Mail = {
	subject: 'Q3: "final"?', from: "Jonas Berg", from_email: "jonas@corp.com", to: "Alexander", cc: "",
	date: "2025-05-12 14:03", folder: "alexa@corp.com/Inbox", attachments: [{ name: "q3.xlsx", size: 20480 }],
	body: "Line one\r\n" + "x".repeat(500), body_length: 510, truncated: false,
};
const r = formatMail(mail, 200);
assert.match(r, /^Subject: Q3: "final"\?\nFrom: Jonas Berg <jonas@corp.com>\nTo: Alexander\nDate: /);
assert.ok(!r.includes("Cc:"), "empty cc hidden");
assert.match(r, /Attachments: q3.xlsx \(20 KB\)/);
assert.match(r, /\[truncated: showing 200 of 510 characters/);
assert.ok(!formatMail(mail, 8000).includes("[truncated"));

const md = toMarkdown(mail);
assert.ok(md.startsWith('---\nsubject: "Q3: \\"final\\"?"\nfrom: "Jonas Berg <jonas@corp.com>"\n'));
assert.match(md, /\n---\n\n# Q3: "final"\?\n\nLine one\nx{500}\n$/);
assert.equal(mailFileName(mail), "2025-05-12 Q3 final.md");

// Tools with a stubbed pi.exec.
const tools = new Map<string, any>();
const calls: { cmd: string; args: string[] }[] = [];
let reply = { stdout: "", stderr: "", code: 0, killed: false };
const pi: any = { registerTool: (t: any) => tools.set(t.name, t), exec: async (cmd: string, args: string[]) => (calls.push({ cmd, args }), reply) };
outlookReader(pi);
assert.deepEqual([...tools.keys()], ["outlook_folders", "outlook_search", "outlook_read"]);

const tmp = mkdtempSync(join(tmpdir(), "outlook-test-"));
const ctx = { cwd: tmp };
const lastReq = () => decode(calls.at(-1)!.args.at(-1)!);
try {
	if (process.platform === "win32") {
		reply = { stdout: JSON.stringify({ results: [hit], folder: "alexa@corp.com/Sent Items", folders_searched: 1, more_may_exist: false }), stderr: "", code: 0, killed: false };
		const out = await tools.get("outlook_search").execute("t1", { folder: "Sent", from: "Jonas" }, undefined, undefined, ctx);
		assert.match(out.content[0].text, /\[m1\]/);
		assert.equal(calls[0].cmd, "powershell.exe");
		assert.ok(calls[0].args.includes("-File") && calls[0].args.includes("-NonInteractive"));
		assert.deepEqual(lastReq(), { action: "search", folder: "Sent", from: "Jonas" });

		await assert.rejects(tools.get("outlook_read").execute("t2", { id: "m7" }, undefined, undefined, ctx), /unknown id 'm7'.*search again/);

		reply = { stdout: JSON.stringify(mail), stderr: "", code: 0, killed: false };
		const read = await tools.get("outlook_read").execute("t3", { id: "m1", max_chars: 300 }, undefined, undefined, ctx);
		assert.deepEqual(lastReq(), { action: "read", entry_id: "E1", store_id: "S1", max_chars: 300 });
		assert.match(read.content[0].text, /^Subject: /);

		const saved = await tools.get("outlook_read").execute("t4", { id: "m1", save_to: "notes" }, undefined, undefined, ctx);
		assert.equal(lastReq().max_chars, 500_000, "save fetches the full body");
		const file = join(tmp, "notes", "2025-05-12 Q3 final.md");
		assert.equal(saved.details.saved, file);
		assert.equal(readFileSync(file, "utf8"), md);
		const again = await tools.get("outlook_read").execute("t5", { id: "m1", save_to: "notes" }, undefined, undefined, ctx);
		assert.equal(again.details.saved, join(tmp, "notes", "2025-05-12 Q3 final (2).md"), "never overwrites");

		reply = { stdout: "", stderr: "outlook: classic Outlook (desktop) is not installed", code: 2, killed: false };
		await assert.rejects(tools.get("outlook_folders").execute("t6", {}, undefined, undefined, ctx), /^Error: outlook: classic Outlook/);
		reply = { stdout: "", stderr: "", code: 1, killed: true };
		await assert.rejects(tools.get("outlook_folders").execute("t7", {}, undefined, undefined, ctx), /timed out/);
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

// PowerShell side (Windows only): DASL filter building and the real script.
if (process.platform === "win32") {
	const ps = (cmd: string) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd], { encoding: "utf8" });
	const filt = ps(`. .\\${SCRIPT}; Build-DaslFilter ([pscustomobject]@{ subject = 'Q3'; from = 'O''Brien' }); '|' + (Build-DaslFilter ([pscustomobject]@{})) + '|'`);
	assert.equal(filt.status, 0, filt.stderr);
	assert.equal(
		filt.stdout.trim(),
		`@SQL="urn:schemas:httpmail:subject" LIKE '%Q3%' AND ("urn:schemas:httpmail:fromname" LIKE '%O''Brien%' OR "urn:schemas:httpmail:fromemail" LIKE '%O''Brien%')\r\n||`,
	);

	const real = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Request", encodeRequest({ action: "folders", max_depth: 1 })], { encoding: "utf8" });
	if (real.status === 0) {
		assert.ok(Array.isArray(JSON.parse(real.stdout).folders), "real Outlook: folders listed");
		console.log("  (classic Outlook found: real folder listing works)");
	} else {
		assert.equal(real.status, 2);
		assert.match(real.stderr, /^outlook: classic Outlook \(desktop\) is not installed/);
		console.log("  (no classic Outlook here: clear error checked)");
	}
}
console.log("outlook: all unit tests passed");
