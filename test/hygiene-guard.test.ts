// Run: node test/hygiene-guard.test.ts  (works in a temp folder outside any repo)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import hygieneGuard, { applyEdits, capReason, strayMdReason } from "../extensions/hygiene-guard.ts";

const T = mkdtempSync(resolve(tmpdir(), "guard-"));
const mk = (rel: string, content = "x\n") => {
	const p = resolve(T, rel);
	mkdirSync(resolve(p, ".."), { recursive: true });
	writeFileSync(p, content);
	return p;
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });

// Check A: stray md files
mk("proj/README.md");
assert.ok(strayMdReason(resolve(T, "proj/notes.md")), "new notes.md blocked");
assert.ok(strayMdReason(resolve(T, "proj/docs/DECISIONS.MD")), "case-insensitive .MD blocked");
assert.equal(strayMdReason(resolve(T, "proj/README.md")), undefined, "existing README editable");
for (const ok of ["AGENTS.md", "PLAN.md", "todo.md", "skills/x/SKILL.md", "prompts/p.md", "snippets/s.md", "agents/a.md", "a.py"])
	assert.equal(strayMdReason(resolve(T, "proj", ok)), undefined, `${ok} allowed`);
mk("vault/.obsidian/app.json");
assert.equal(strayMdReason(resolve(T, "vault/deep/note.md")), undefined, "vault note allowed");
mk("proj/skills/y/SKILL.md");
assert.equal(strayMdReason(resolve(T, "proj/skills/y/references/api.md")), undefined, "skill reference allowed");

// Check B: AGENTS.md cap
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";
assert.ok(capReason(lines(201))?.includes("201 lines"), "201 lines blocked");
assert.equal(capReason(lines(150)), undefined, "150 lines allowed");
assert.equal(capReason(lines(200)), undefined, "200 lines allowed");
assert.ok(capReason("x".repeat(16_001)), "16,001 chars blocked");
assert.equal(applyEdits("a\r\nb\r\nc", [{ oldText: "a\nb", newText: "A" }, { oldText: "c", newText: "C" }]), "A\nC");
assert.equal(applyEdits("abc", [{ oldText: "zzz", newText: "" }]), undefined, "missing oldText: no verdict");

// Full handler with a fake pi that runs real git
let handler: any;
const fakePi: any = {
	on: (name: string, fn: any) => name === "tool_call" && (handler = fn),
	exec: async (cmd: string, args: string[]) => {
		const r = spawnSync(cmd, args, { encoding: "utf8" });
		return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? 1, killed: false };
	},
};
hygieneGuard(fakePi);
const call = (cwd: string, toolName: string, input: any) => handler({ toolName, input }, { cwd });

const repo = resolve(T, "repo");
mkdirSync(repo, { recursive: true });
git(repo, "init", "-q", "-b", "main");
assert.equal(await call(repo, "write", { path: "a.py", content: "" }), undefined, "no commits yet: allowed");
mk("repo/a.py");
git(repo, "add", ".");
git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
const onMain = await call(repo, "edit", { path: "a.py", edits: [] });
assert.equal(onMain?.block, true, "edit on main blocked");
assert.match(onMain.reason, /git switch -c/);
assert.equal((await call(repo, "write", { path: "new/dir/b.py", content: "" }))?.block, true, "new subfolder on main blocked");
git(repo, "switch", "-q", "-c", "x");
assert.equal(await call(repo, "edit", { path: "a.py", edits: [] }), undefined, "task branch allowed");
assert.equal((await call(repo, "write", { path: "notes.md", content: "" }))?.block, true, "notes.md blocked by handler");
assert.equal((await call(repo, "write", { path: "AGENTS.md", content: lines(201) }))?.block, true, "big AGENTS.md write blocked");
mk("repo/AGENTS.md", lines(150));
assert.equal(await call(repo, "edit", { path: "AGENTS.md", edits: [{ oldText: "line 0\n", newText: "L\n" }] }), undefined);
assert.equal(
	(await call(repo, "edit", { path: "AGENTS.md", edits: [{ oldText: "line 0\n", newText: lines(60) }] }))?.block,
	true,
	"edit growing AGENTS.md past cap blocked",
);
mk("plain/a.py");
assert.equal(await call(resolve(T, "plain"), "write", { path: "a.py", content: "" }), undefined, "non-git allowed");
assert.equal(await call(repo, "read", { path: "notes.md" }), undefined, "other tools ignored");

rmSync(T, { recursive: true, force: true });
console.log("hygiene-guard: all unit tests passed");
