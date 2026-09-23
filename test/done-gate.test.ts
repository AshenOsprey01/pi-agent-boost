// Unit tests for Done-Gate's pure logic. Run: node test/done-gate.test.ts
import assert from "node:assert/strict";
import { shouldFire, MUTATING_TOOLS } from "../extensions/done-gate.ts";

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
console.log("done-gate: all unit tests passed");
