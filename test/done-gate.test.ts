// Unit tests for Done-Gate's pure logic. Run: node test/done-gate.test.ts
import assert from "node:assert/strict";
import { shouldFire, MUTATING_TOOLS, GATE_TEXT } from "../extensions/done-gate.ts";

const ok = [{ role: "user" }, { role: "assistant", stopReason: "stop" }];
const base = { enabled: true, edited: true, fired: false };

assert.equal(shouldFire(base, ok), true, "edited run fires");
assert.equal(shouldFire({ ...base, edited: false }, ok), false, "no edits: no fire");
assert.equal(shouldFire({ ...base, fired: true }, ok), false, "already fired: no fire");
assert.equal(shouldFire({ ...base, enabled: false }, ok), false, "disabled: no fire");
assert.equal(shouldFire(base, [{ role: "assistant", stopReason: "aborted" }]), false, "aborted: no fire");
assert.equal(shouldFire(base, [{ role: "assistant", stopReason: "error" }]), false, "error: no fire");
assert.equal(shouldFire(base, []), true, "no assistant message: still fires");
assert.ok(MUTATING_TOOLS.has("edit") && MUTATING_TOOLS.has("write") && !MUTATING_TOOLS.has("bash"));
assert.match(GATE_TEXT, /\(3\) remove any comments you added that only restate the code/, "hygiene clause");
assert.ok(GATE_TEXT.includes("delete PLAN.md/TODO.md"));
assert.ok(GATE_TEXT.includes("wait for my approval, do not continue"), "respects pauses");
console.log("done-gate: all unit tests passed");
