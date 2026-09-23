// Unit tests for Output Trimmer's pure logic. Run: node --import ./test/stub-pi.mjs test/output-trimmer.test.ts
import assert from "node:assert/strict";
import { SHELL_TOOLS, trimText } from "../extensions/output-trimmer.ts";

const size = (s: string) => Buffer.byteLength(s, "utf8");
const path = () => "/tmp/pi-boost/x.txt";

// Small output: untouched, and the path callback is never called.
let called = false;
assert.equal(trimText("hello\nworld", 8000, () => ((called = true), "p")), null);
assert.equal(called, false);

// 100 KB of numbered lines: ~7 KB result with head, tail, correct counts.
const lines = Array.from({ length: 2000 }, (_, i) => `row ${String(i).padStart(4, "0")} ${"x".repeat(40)}`);
const big = lines.join("\n");
assert.ok(size(big) > 90_000);
const r = trimText(big, 8000, path)!;
assert.ok(r, "trimmed");
assert.ok(size(r.text) < 7500 && size(r.text) > 5000, `size ${size(r.text)}`);
assert.ok(r.text.startsWith("row 0000") && r.text.trimEnd().endsWith(lines[1999]));
assert.match(r.text, /\[output-trimmer: \d+ lines \/ [\d.]+ KB omitted — full output: \/tmp\/pi-boost\/x\.txt — use read to see more\]/);
const kept = r.text.split("\n").filter((l) => l.startsWith("row ")).length;
assert.equal(kept + r.omittedLines, 2000, "line accounting");

// Pi's truncation note is preserved at the very end.
const withNote = big + "\n\n[Showing lines 1-2000 of 9000. Full output: C:\\T\\pi-bash-1.log]";
const r2 = trimText(withNote, 8000, () => "C:\\T\\pi-bash-1.log")!;
assert.ok(r2.text.endsWith("[Showing lines 1-2000 of 9000. Full output: C:\\T\\pi-bash-1.log]"));

// One giant line (minified JSON): cut by characters, still under the cap.
const giant = "{" + "\"k\":1,".repeat(20000) + "}";
const r3 = trimText(giant, 8000, path)!;
assert.ok(r3 && size(r3.text) < 8500, `giant size ${size(r3.text)}`);

// Disabled.
assert.equal(trimText(big, 0, path), null);
assert.ok(SHELL_TOOLS.has("bash") && SHELL_TOOLS.has("powershell") && !SHELL_TOOLS.has("read"));
console.log("output-trimmer: all unit tests passed");
